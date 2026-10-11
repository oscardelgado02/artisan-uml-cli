// `artisan serve` — local server for the editor: static files + tiny JSON API.
// Binds 127.0.0.1 only. Autosaves editor edits to .artisan/diagram.json and
// regenerates diagram.puml so the AI always sees fresh architecture.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { toPlantUML } from './diagram.mjs';
import { appendLog } from './scan.mjs';
import { artisanDir, normalizeDiagram, readJSON, writeJSON } from './store.mjs';
import { runReject } from './diff.mjs';
import { implDiff } from './impldiff.mjs';
import { refreshEmbedded } from './embed.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.puml': 'text/plain; charset=utf-8',
};

function sendJSON(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

// Optimistic concurrency: rev bumps whenever diagram.json changes on disk
// (CLI edits, scans, agent writes). Editor PUTs must carry the rev it last
// saw (If-Match); a mismatch means a stale tab tried to save — rejected with
// 409 so disk (CLI/scan state) always wins over stale browser state.
let rev = 0;
let lastMtime = -1;
function currentRev() {
  let m = -1;
  try {
    m = fs.statSync(artisanDir('diagram.json')).mtimeMs;
  } catch {
    /* no file yet */
  }
  if (m !== lastMtime) {
    lastMtime = m;
    rev++;
  }
  return rev;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 20e6) req.destroy();
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function saveDiagram(raw) {
  const diagram = normalizeDiagram(JSON.parse(raw));
  writeJSON(artisanDir('diagram.json'), diagram);
  fs.writeFileSync(artisanDir('diagram.puml'), toPlantUML(diagram));
  refreshEmbedded();
  return diagram;
}

export function runServe({ port = 4173 }) {
  const editorDir = path.resolve(artisanDir('editor'));
  if (!fs.existsSync(path.join(editorDir, 'index.html'))) {
    console.error('No editor in .artisan/editor — run `artisan scan` first.');
    process.exit(1);
  }
  refreshEmbedded(); // diagram.html present/fresh even if scan ran elsewhere
  const server = http.createServer(async (req, res) => {
    const url = (req.url || '/').split('?')[0];
    try {
      if (url === '/api/diagram' && req.method === 'GET') {
        res.setHeader('X-Artisan-Rev', String(currentRev()));
        return sendJSON(res, 200, readJSON(artisanDir('diagram.json')) || { nodes: [], edges: [] });
      }
      if (url === '/api/diagram' && req.method === 'PUT') {
        const rev = currentRev();
        const match = req.headers['if-match'];
        if (match && Number(match) !== rev) {
          return sendJSON(res, 409, { error: 'diagram changed on disk — reload', rev });
        }
        const diagram = saveDiagram(await readBody(req));
        return sendJSON(res, 200, { ok: true, seq: diagram.seq, rev: currentRev() });
      }
      if (url === '/api/pending' && req.method === 'GET') {
        return sendJSON(res, 200, readJSON(artisanDir('pending.json')) || []);
      }
      if (url === '/api/pending' && req.method === 'POST') {
        // editor-recorded refs (disk-diff detections) persist like CLI ones
        const body = JSON.parse((await readBody(req)) || '{}');
        const refs = Array.isArray(body.refs) ? body.refs : Array.isArray(body) ? body : [];
        if (!refs.length) return sendJSON(res, 200, { ok: true, added: 0 });
        const pending = readJSON(artisanDir('pending.json')) || [];
        const keyOf = (r) => `${r.type}:${r.id}:${r.change}`;
        const known = new Set(pending.map(keyOf));
        const fresh = refs.filter((r) => r && r.type && r.id && r.change && !known.has(keyOf(r)));
        if (fresh.length) {
          writeJSON(artisanDir('pending.json'), [...pending, ...fresh]);
          refreshEmbedded();
        }
        return sendJSON(res, 200, { ok: true, added: fresh.length });
      }
      if (url === '/api/ack' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}');
        const diagram = normalizeDiagram(readJSON(artisanDir('diagram.json')));
        const pending = readJSON(artisanDir('pending.json')) || [];
        if (Array.isArray(body.keys) && body.keys.length) {
          // per-item accept: only the given refs (type:id:change keys)
          const keep = pending.filter((r) => !body.keys.includes(`${r.type}:${r.id}:${r.change}`));
          writeJSON(artisanDir('pending.json'), keep);
          appendLog('human', `accepted ${body.keys.length} AI change(s) individually`);
          return sendJSON(res, 200, { ok: true, remaining: keep.length });
        }
        writeJSON(artisanDir('pending.json'), []);
        writeJSON(artisanDir('last-human.json'), diagram);
        appendLog('human', `acknowledged ${pending.length} AI changes (from editor)`);
        return sendJSON(res, 200, { ok: true });
      }
      if (url === '/api/reject' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}');
        runReject({ keys: Array.isArray(body.keys) ? body.keys : [] });
        const diagram = normalizeDiagram(readJSON(artisanDir('diagram.json')));
        const remaining = readJSON(artisanDir('pending.json')) || [];
        return sendJSON(res, 200, { ok: true, remaining: remaining.length, diagram });
      }
      if (url === '/api/status' && req.method === 'GET') {
        const pending = readJSON(artisanDir('pending.json')) || [];
        return sendJSON(res, 200, { server: true, pending: pending.length });
      }
      if (url === '/api/impl' && req.method === 'GET') {
        // live impl-diff summary for the editor's code-sync badge (parses the
        // codebase — polled slowly, not every pending tick)
        const { res: r } = implDiff({ src: '.' });
        const summary = {
          changed: !!(r.added.length || r.removed.length || r.modified.length),
          counts: { missing: r.removed.length, drift: r.added.length, mismatch: r.modified.length },
        };
        writeJSON(artisanDir('impl-diff.json'), { ...summary, t: new Date().toISOString() });
        return sendJSON(res, 200, summary);
      }
      // static editor
      let p = path.normalize(url).replace(/^([/\\]|\.\.)+/, '');
      if (p === '/' || p === '') p = 'index.html';
      const file = path.join(editorDir, p);
      if (!file.startsWith(editorDir)) {
        res.writeHead(403);
        return res.end();
      }
      let data;
      try {
        data = fs.readFileSync(file);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch (e) {
      return sendJSON(res, 400, { error: String((e && e.message) || e) });
    }
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    console.log(`Artisan editor: ${url}`);
    console.log('Edits autosave to .artisan/diagram.json — leave this running while you edit.');
    for (const cmd of ['xdg-open', 'open']) {
      try {
        spawn(cmd, [url], { stdio: 'ignore', detached: true }).on('error', () => {});
        break;
      } catch {
        /* try next */
      }
    }
  });
}
