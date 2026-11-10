// `artuml scaffold` — mechanical code sync from the impl-diff result.
// Creates stub classes/members the diagram wants, patches signatures to match,
// applies detected renames (silently), moves sole-type files to their node's
// `dir`, and (gated by prompt / --yes / askBeforeRemove) removes code the
// diagram dropped. Judgement work stays with the agent: method bodies,
// call-site refactors outside touched files, adopting leftovers. Never
// touches diagram state (last-ai/pending); refreshes impl-diff.json so the
// editor's drift badge clears.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { artisanDir, normalizeDiagram, readJSON, writeJSON } from './store.mjs';
import { implDiff } from './impldiff.mjs';
import { loadConfig, normalizeProjectDir } from './config.mjs';
import { appendLog } from './scan.mjs';

const VIS_KEYWORD = { '+': 'public', '-': 'private', '#': 'protected', '~': 'internal' };
const KIND_KEYWORD = { class: 'class', abstract: 'class', interface: 'interface', enum: 'enum', record: 'record', struct: 'struct' };

// --- small text/C# helpers ---------------------------------------------------

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const visKw = (v) => VIS_KEYWORD[v] || 'public';
const kindDecl = (kind) => (kind === 'abstract' ? 'abstract class' : KIND_KEYWORD[kind] || 'class');

// split on top-level commas only (types may nest <>, (), [])
function splitTop(s) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if ('<(['.includes(ch)) depth++;
    else if ('>)])'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

// diagram param format ("name: type") → C# ("type name")
function csParams(uml) {
  const t = (uml || '').trim();
  if (!t) return '';
  return splitTop(t)
    .map((p) => {
      const m = p.match(/^([A-Za-z_][\w<>\[\],.?]*)\s*:\s*([\s\S]+)$/);
      return m ? `${m[2].trim()} ${m[1].trim()}` : p;
    })
    .join(', ');
}

const normParams = (s) =>
  splitTop(String(s || '').replace(/\s+/g, ' '))
    .map((p) => p.replace(/\s+/g, ' ').trim().toLowerCase())
    .join(',');

// Walk raw C# text calling cb(i, c) per CODE character (comments, strings,
// chars skipped as noise). Indices are raw-text coordinates.
function codeWalk(raw, from, to, cb) {
  let mode = 'code';
  for (let i = from; i < to; i++) {
    const c = raw[i];
    const c2 = raw[i + 1];
    if (mode === 'code') {
      if (c === '/' && c2 === '/') { mode = 'line'; i++; continue; }
      if (c === '/' && c2 === '*') { mode = 'block'; i++; continue; }
      if (c === '"') { mode = 'str'; i++; continue; }
      if (c === "'") { mode = 'char'; i++; continue; }
      cb(i, c);
    } else if (mode === 'line') {
      if (c === '\n') mode = 'code';
    } else if (mode === 'block') {
      if (c === '*' && c2 === '/') { mode = 'code'; i++; }
    } else if (mode === 'str') {
      if (c === '\\') i++;
      else if (c === '"') mode = 'code';
    } else {
      if (c === '\\') i++;
      else if (c === "'") mode = 'code';
    }
  }
}

function matchPair(raw, open, openCh, closeCh) {
  let depth = 0;
  let close = -1;
  codeWalk(raw, open, raw.length, (i, c) => {
    if (close >= 0) return;
    if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) close = i;
    }
  });
  return close;
}
const matchBrace = (raw, open) => matchPair(raw, open, '{', '}');
const matchParen = (raw, open) => matchPair(raw, open, '(', ')');

// brace depth between a class body's open brace and a raw index (members sit at 0)
function depthAt(raw, open, idx) {
  let depth = 0;
  codeWalk(raw, open + 1, idx, (i, c) => {
    if (c === '{') depth++;
    else if (c === '}') depth--;
  });
  return depth;
}

const skipSpaces = (raw, i) => {
  while (i < raw.length && /\s/.test(raw[i])) i++;
  return i;
};

// statement start: line start, extended up over attribute/doc-comment lines
function stmtStart(raw, idx) {
  let s = raw.lastIndexOf('\n', idx - 1) + 1;
  for (;;) {
    const ps = s > 0 ? raw.lastIndexOf('\n', s - 2) + 1 : 0;
    const line = raw.slice(ps, s).trim();
    if (ps !== s && /^(\[|\/\/|\/\*|#)/.test(line)) s = ps;
    else break;
  }
  return s;
}

// next ';' at brace/paren depth 0 (field initializers, expression bodies)
function nextSemi(raw, from) {
  let depth = 0;
  for (let i = from; i < raw.length; i++) {
    const c = raw[i];
    if (c === '{' || c === '(') depth++;
    else if (c === '}' || c === ')') depth--;
    else if (c === ';' && depth === 0) return i;
  }
  return raw.length - 1;
}

// class/interface/enum/struct block for a type name → { declIdx, open, close } | null
function findTypeBlock(raw, name) {
  const m = new RegExp(`\\b(?:class|struct|interface|enum|record)\\s+${escapeRe(name)}\\b`).exec(raw);
  if (!m) return null;
  let open = -1;
  let mode = 'code';
  for (let i = m.index + m[0].length; i < raw.length; i++) {
    const c = raw[i];
    const c2 = raw[i + 1];
    if (mode === 'code') {
      if (c === '/' && c2 === '/') { mode = 'line'; i++; }
      else if (c === '/' && c2 === '*') { mode = 'block'; i++; }
      else if (c === '"') { mode = 'str'; i++; }
      else if (c === "'") { mode = 'char'; i++; }
      else if (c === ';') return null; // forward declaration, no body here
      else if (c === '{') { open = i; break; }
    } else if (mode === 'line') { if (c === '\n') mode = 'code'; }
    else if (mode === 'block') { if (c === '*' && c2 === '/') { mode = 'code'; i++; } }
    else if (mode === 'str') { if (c === '\\') i++; else if (c === '"') mode = 'code'; }
    else { if (c === '\\') i++; else if (c === "'") mode = 'code'; }
  }
  if (open < 0) return null;
  return { declIdx: m.index, open, close: matchBrace(raw, open) };
}

// locate a member declaration inside a class body (depth 0 only — usages in
// method bodies sit deeper). Methods additionally require params to match;
// with several overloads and no exact match, a single overload is accepted.
function findMemberDeclPos(raw, block, mem) {
  const isMethod = mem.params != null;
  const want = normParams(csParams(mem.params));
  const re = new RegExp(`\\b${escapeRe(mem.name)}\\b`, 'g');
  re.lastIndex = block.open + 1;
  let m;
  let count = 0;
  let only = null;
  while ((m = re.exec(raw)) && m.index < block.close) {
    if (depthAt(raw, block.open, m.index) !== 0) continue;
    const j = skipSpaces(raw, m.index + mem.name.length);
    if (isMethod) {
      if (raw[j] !== '(') continue;
      count++;
      const close = matchParen(raw, j);
      const pos = { nameIdx: m.index, paramsEnd: close, kind: 'method' };
      if (normParams(raw.slice(j + 1, close)) === want) return pos;
      if (count === 1) only = pos;
      continue;
    }
    if (!';={'.includes(raw[j])) continue;
    return { nameIdx: m.index, declEnd: j, kind: 'attr' };
  }
  return isMethod ? (count === 1 ? only : null) : null;
}

// last non-keyword token before the member name in the code = declared type
function codeRetType(raw, start, nameIdx) {
  const KW = new Set(['public', 'private', 'protected', 'internal', 'static', 'abstract', 'sealed', 'virtual', 'override', 'async', 'readonly', 'const', 'extern', 'unsafe', 'partial', 'event', 'new']);
  const toks = raw.slice(start, nameIdx).trim().split(/\s+/).filter(Boolean);
  const rest = toks.filter((t) => !KW.has(t));
  return rest.length ? rest[rest.length - 1] : '';
}

// --- rendering ---------------------------------------------------------------

function memberLines(mem, kind, stubBody, mpad) {
  if (kind === 'enum') return [`${mpad}${mem.name},`];
  const vis = visKw(mem.vis);
  const mods = (mem.mods || []).filter((x) => x !== 'const');
  const modStr = mods.length ? mods.join(' ') + ' ' : '';
  const noBody = kind === 'interface' || mods.includes('abstract');
  const note = mem.note ? [`${mpad}// NOTE: ${mem.note}`] : [];
  if (mem.params != null) {
    const head = `${mpad}${vis} ${modStr}${mem.type || 'object'} ${mem.name}(${csParams(mem.params)})`;
    if (noBody) return [...note, head + ';'];
    if (stubBody === 'empty') return [...note, head + ' { }'];
    if (stubBody === 'todo') return [...note, head, `${mpad}{`, `${mpad}    // TODO: scaffold`, `${mpad}}`];
    return [...note, head, `${mpad}{`, `${mpad}    throw new NotImplementedException();`, `${mpad}}`];
  }
  const type = mem.type || 'object';
  if (kind === 'interface') return [...note, `${mpad}${vis} ${modStr}${type} ${mem.name} { get; set; }`];
  return [...note, `${mpad}${vis} ${modStr}${type} ${mem.name};`];
}

function renderStub(node, stubBody, ns) {
  const pad = ns ? '    ' : '';
  const L = [];
  if (ns) L.push(`namespace ${ns}`, '{', '');
  if (node.note) L.push(`${pad}// NOTE: ${node.note}`);
  L.push(`${pad}public ${kindDecl(node.kind)} ${node.name}`);
  L.push(`${pad}{`);
  const mpad = pad + '    ';
  for (const m of node.attributes || []) L.push(...memberLines(m, node.kind, stubBody, mpad));
  if ((node.attributes || []).length && (node.methods || []).length) L.push('');
  for (const m of node.methods || []) L.push(...memberLines(m, node.kind, stubBody, mpad));
  L.push(`${pad}}`);
  if (ns) L.push('');
  return L.join('\n') + '\n';
}

function spliceMember(raw, block, mem, kind, stubBody) {
  let s = raw.lastIndexOf('\n', block.open - 1) + 1;
  const lead = raw.slice(s, block.open).match(/^[ \t]*/)[0];
  const mpad = lead + '    ';
  const lines = memberLines(mem, kind, stubBody, mpad);
  return raw.slice(0, block.close) + '\n' + lines.join('\n') + raw.slice(block.close);
}

function replaceWord(text, from, to) {
  return text.replace(new RegExp(`\\b${escapeRe(from)}\\b`, 'g'), to);
}

// replace a member's signature chunk with the diagram's version (body kept)
function patchMember(raw, block, mem) {
  const pos = findMemberDeclPos(raw, block, mem);
  if (!pos) return null;
  const start = stmtStart(raw, pos.nameIdx);
  const mods = (mem.mods || []).filter((x) => x !== 'const');
  const modStr = mods.length ? ' ' + mods.join(' ') : '';
  if (pos.kind === 'method') {
    // diagram-unspecified return type keeps the code's own
    const ret = mem.type || codeRetType(raw, start, pos.nameIdx) || 'void';
    const sig = `${visKw(mem.vis)}${modStr} ${ret} ${mem.name}(${csParams(mem.params)})`;
    return raw.slice(0, start) + sig + raw.slice(pos.paramsEnd + 1);
  }
  const type = mem.type || codeRetType(raw, start, pos.nameIdx) || 'object';
  const sig = `${visKw(mem.vis)}${modStr} ${type} ${mem.name}`;
  return raw.slice(0, start) + sig + raw.slice(pos.nameIdx + mem.name.length);
}

function patchKind(raw, block, targetKind) {
  const seg = raw.slice(block.declIdx, block.open);
  const m = /\b(abstract\s+)?(class|struct|interface|enum|record)\b/.exec(seg);
  if (!m) return raw;
  return raw.slice(0, block.declIdx) + seg.slice(0, m.index) + kindDecl(targetKind) + seg.slice(m.index + m[0].length) + raw.slice(block.open);
}

// removal end for a member declaration (method bodies, property blocks, initializers)
function memberEnd(raw, pos) {
  if (pos.kind === 'method') {
    let i = pos.paramsEnd + 1;
    while (i < raw.length && /[A-Za-z0-9_<>\[\],:\s.]/.test(raw[i])) i++; // generic constraints / where
    if (raw[i] === '{') return matchBrace(raw, i) + 1;
    if (raw.startsWith('=>', i)) return nextSemi(raw, i + 2) + 1;
    if (raw[i] === ';') return i + 1;
    return i;
  }
  const c = raw[pos.declEnd];
  if (c === ';') return pos.declEnd + 1;
  if (c === '{') {
    let e = matchBrace(raw, pos.declEnd) + 1;
    const k = skipSpaces(raw, e);
    if (raw[k] === ';') e = k + 1;
    return e;
  }
  return nextSemi(raw, pos.declEnd + 1) + 1;
}

const consumeTrailing = (raw, end) => {
  while (raw[end] === ' ' || raw[end] === '\t' || raw[end] === '\r') end++;
  if (raw[end] === '\n') end++;
  return end;
};

// --- removal gate ------------------------------------------------------------

async function confirmRemoval(lines, yes) {
  if (yes || loadConfig().askBeforeRemove === false) return true;
  const list = lines.map((l) => `  - ${l}`).join('\n');
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(`Non-interactive session: skipped ${lines.length} removal(s). Re-run with --yes to apply:\n${list}`);
    return false;
  }
  console.log(`About to remove ${lines.length} item(s) from the code:\n${list}`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question('Remove these from the code? [y/N] ')).trim().toLowerCase();
  rl.close();
  return ans === 'y' || ans === 'yes';
}

// --- the command -------------------------------------------------------------

export async function runScaffold({ src = '.', json = false, yes = false } = {}) {
  if (!readJSON(artisanDir('diagram.json'))) throw new Error('No .artisan/diagram.json — run `artuml scan` first.');
  const diagram = normalizeDiagram(readJSON(artisanDir('diagram.json')));
  const { res, map } = implDiff({ src });
  const root = process.cwd();
  const cfg = loadConfig();
  const stubBody = ['throw', 'empty', 'todo'].includes(cfg.stubBody) ? cfg.stubBody : 'throw';
  const srcRel = path.relative(root, path.resolve(src)).split(path.sep).join('/') || '.';

  const out = { created: [], renamed: [], moved: [], patched: [], removed: [], skipped: [], agent: [] };
  const nodeByName = new Map(diagram.nodes.map((n) => [n.name, n]));

  // location overlays, kept current as files are renamed/moved/created/removed
  const fileOf = new Map(); // class short name → rel file ('/'-joined)
  const nsByDir = new Map(); // dir → namespace of a same-dir sibling
  const typesInFile = new Map(); // rel file → Set(short names)
  for (const m of Object.values(map)) {
    const short = m.full.split('.').pop();
    fileOf.set(short, m.file);
    const d = path.posix.dirname(m.file);
    if (m.namespace && !nsByDir.has(d)) nsByDir.set(d, m.namespace);
    if (!typesInFile.has(m.file)) typesInFile.set(m.file, new Set());
    typesInFile.get(m.file).add(short);
  }
  const renamedClasses = new Map(); // old code name → new name (this run)
  const cur = (name) => renamedClasses.get(name) || name;
  const readFile = (rel) => fs.readFileSync(path.resolve(root, rel), 'utf8');
  const writeFile = (rel, text) => fs.writeFileSync(path.resolve(root, rel), text);
  const safeDir = (raw, what) => {
    try {
      return normalizeProjectDir(raw);
    } catch (e) {
      out.skipped.push(`${what}: invalid directory "${raw}" — ${e.message}`);
      return '';
    }
  };

  // 1) renames — silent. from = diagram (target), to = code (current).
  for (const r of res.renames) {
    if (r.kind !== 'class-rename') continue;
    const from = cur(r.to);
    const target = r.from;
    if (from === target) continue;
    const file = fileOf.get(from);
    if (!file) {
      out.agent.push(`rename class ${r.to} → ${target} by hand (source file unknown)`);
      continue;
    }
    let raw = readFile(file);
    raw = replaceWord(raw, from, target);
    const occupants = typesInFile.get(file) || new Set();
    let newFile = file;
    if (occupants.size === 1 && occupants.has(from)) {
      const dir = path.posix.dirname(file);
      newFile = (dir === '.' ? '' : dir + '/') + target + '.cs';
      fs.mkdirSync(path.dirname(path.resolve(root, newFile)), { recursive: true });
      fs.renameSync(path.resolve(root, file), path.resolve(root, newFile));
      occupants.delete(from);
      occupants.add(target);
    }
    writeFile(newFile, raw);
    out.renamed.push(`class ${from} → ${target} — ${file}${newFile !== file ? ` → ${newFile}` : ' (file shared: declaration renamed in place)'}`);
    fileOf.delete(from);
    fileOf.set(target, newFile);
    for (const nm of occupants) fileOf.set(nm, newFile);
    typesInFile.delete(file);
    typesInFile.set(newFile, occupants);
    renamedClasses.set(from, target);
  }
  for (const r of res.renames) {
    if (r.kind === 'class-rename') continue;
    const cls = cur(r.class);
    const file = fileOf.get(cls);
    if (!file) {
      out.agent.push(`rename ${r.class}.${r.to} → ${r.from} by hand (source file unknown)`);
      continue;
    }
    writeFile(file, replaceWord(readFile(file), r.to, r.from));
    out.renamed.push(`${cls}.${r.to} → ${r.from} — in ${file} (call sites outside the file are yours)`);
  }

  // 2) moves — scaffold is the only mover; sole-type files only, silent.
  for (const n of diagram.nodes) {
    if (!n.dir) continue;
    const dir = safeDir(n.dir, `${n.name}.dir`);
    if (!dir) continue;
    const file = fileOf.get(n.name);
    if (!file) continue;
    const d = path.posix.dirname(file);
    const curDir = d === '.' ? '.' : d;
    if (curDir === dir) continue;
    const occupants = typesInFile.get(file) || new Set();
    if (occupants.size !== 1) {
      out.agent.push(`${n.name}: move to ${dir} by hand — ${file} holds several types`);
      continue;
    }
    const newFile = (dir === '.' ? '' : dir + '/') + path.posix.basename(file);
    fs.mkdirSync(path.dirname(path.resolve(root, newFile)), { recursive: true });
    fs.renameSync(path.resolve(root, file), path.resolve(root, newFile));
    for (const nm of occupants) fileOf.set(nm, newFile);
    typesInFile.delete(file);
    typesInFile.set(newFile, occupants);
    out.moved.push(`${file} → ${newFile} (${n.name}; namespace not rewritten — check for drift)`);
  }

  // 3) creations — diagram items missing from code (stub class files + member splices)
  const removedClassNames = new Set(res.removed.filter((r) => r.type === 'class').map((r) => r.name));
  for (const r of res.removed) {
    if (r.type === 'class') {
      const node = r.ghost && r.ghost.name ? r.ghost : nodeByName.get(r.name);
      const dir = safeDir(node && node.dir, `${r.name}.dir`) || safeDir(cfg.scaffoldDir, 'scaffoldDir') || srcRel;
      const file = (dir === '.' ? '' : dir + '/') + r.name + '.cs';
      if (fs.existsSync(path.resolve(root, file))) {
        out.skipped.push(`${r.name}: ${file} already exists — merge by hand`);
        continue;
      }
      const ns = nsByDir.get(dir) || '';
      fs.mkdirSync(path.dirname(path.resolve(root, file)), { recursive: true });
      writeFile(file, renderStub(node || { kind: 'class', name: r.name, attributes: [], methods: [] }, stubBody, ns));
      fileOf.set(r.name, file);
      typesInFile.set(file, new Set([r.name]));
      const attrs = (node && node.attributes || []).length;
      const meths = (node && node.methods || []).length;
      out.created.push(`${file} — ${r.kind} ${r.name} (${attrs} attributes, ${meths} methods)`);
      continue;
    }
    if (r.type === 'relation') {
      out.agent.push(`diagram relation missing from code — write it by hand or drop it from the diagram: ${r.name}`);
      continue;
    }
    if (removedClassNames.has(r.class)) continue; // covered by the class stub
    const mem = r.ghost && r.ghost.member;
    const cls = cur(r.class);
    const file = fileOf.get(cls);
    if (!mem || !file) {
      out.agent.push(`${r.class}.${r.name}: create by hand (source file unknown)`);
      continue;
    }
    const raw = readFile(file);
    const block = findTypeBlock(raw, cls);
    if (!block) {
      out.skipped.push(`${cls}.${r.name}: class body not found in ${file}`);
      continue;
    }
    writeFile(file, spliceMember(raw, block, mem, (nodeByName.get(cls) || {}).kind, stubBody));
    out.created.push(`${cls}.${r.name}${mem.params != null ? '(...)' : ''} — spliced into ${file}`);
  }

  // 4) patches — signature mismatches (kind swaps + member signatures)
  for (const m of res.modified) {
    if (!m.mid) {
      const cls = cur(m.ghost && m.ghost.name ? m.ghost.name : m.ref.replace(/^class /, ''));
      const file = fileOf.get(cls);
      if (!file) {
        out.agent.push(`${m.ref}: patch by hand — ${m.what}`);
        continue;
      }
      const raw = readFile(file);
      const block = findTypeBlock(raw, cls);
      if (!block) {
        out.skipped.push(`${m.ref}: declaration not found in ${file}`);
        continue;
      }
      writeFile(file, patchKind(raw, block, m.ghost.kind));
      out.patched.push(`${m.ref} — ${m.what}`);
      continue;
    }
    const mem = m.ghost && m.ghost.member;
    const cls = cur(m.ref.slice(0, m.ref.lastIndexOf('.')));
    const file = fileOf.get(cls);
    if (!mem || !file) {
      out.agent.push(`${m.ref}: patch by hand — ${m.what}`);
      continue;
    }
    const raw = readFile(file);
    const block = findTypeBlock(raw, cls);
    if (!block) {
      out.skipped.push(`${m.ref}: class body not found in ${file}`);
      continue;
    }
    const patched = patchMember(raw, block, mem);
    if (!patched) {
      out.skipped.push(`${m.ref}: member declaration not found in ${file}`);
      continue;
    }
    writeFile(file, patched);
    out.patched.push(`${m.ref} — signature updated to match the diagram`);
  }

  // 5) removals — code the diagram dropped; gated, never silent without consent
  const addedClassNames = new Set(res.added.filter((r) => r.type === 'class').map((r) => r.name));
  const cand = [];
  for (const r of res.added) {
    if (r.type === 'relation') {
      out.agent.push(`code-only relation — adopt into the diagram or remove by hand: ${r.name}`);
      continue;
    }
    if (r.type === 'class') cand.push({ kind: 'class', name: r.name, label: `Class ${r.name} (${r.kind})` });
    else if (!addedClassNames.has(r.class)) cand.push({ kind: 'member', name: r.name, class: r.class, params: r.params ?? null, label: `${r.class}: ${r.what}` });
  }
  if (cand.length) {
    const approved = await confirmRemoval(cand.map((c) => c.label), yes);
    if (!approved) {
      for (const c of cand) out.agent.push(`kept (removal declined) — adopt into the diagram or remove by hand: ${c.label}`);
    } else {
      for (const c of cand) {
        const file = fileOf.get(c.kind === 'class' ? c.name : c.class);
        if (!file) {
          out.skipped.push(`${c.label}: source file unknown`);
          continue;
        }
        if (c.kind === 'class') {
          const occupants = typesInFile.get(file) || new Set();
          const rest = new Set([...occupants].filter((x) => x !== c.name));
          if (!rest.size) {
            fs.rmSync(path.resolve(root, file));
            typesInFile.delete(file);
            for (const nm of occupants) fileOf.delete(nm);
            out.removed.push(`Class ${c.name} — ${file} deleted`);
          } else {
            const raw = readFile(file);
            const block = findTypeBlock(raw, c.name);
            if (!block) {
              out.skipped.push(`Class ${c.name}: declaration not found in ${file}`);
              continue;
            }
            const start = stmtStart(raw, block.declIdx);
            writeFile(file, raw.slice(0, start) + raw.slice(consumeTrailing(raw, block.close + 1)));
            occupants.delete(c.name);
            out.removed.push(`Class ${c.name} — removed from ${file}`);
          }
        } else {
          const raw = readFile(file);
          const block = findTypeBlock(raw, cur(c.class));
          if (!block) {
            out.skipped.push(`${c.label}: class body not found in ${file}`);
            continue;
          }
          const mem = { params: c.params, name: c.name };
          const pos = findMemberDeclPos(raw, block, mem);
          if (!pos) {
            out.skipped.push(`${c.label}: member not found in ${file}`);
            continue;
          }
          const start = stmtStart(raw, pos.nameIdx);
          writeFile(file, raw.slice(0, start) + raw.slice(consumeTrailing(raw, memberEnd(raw, pos))));
          out.removed.push(`${c.label} — removed from ${file}`);
        }
      }
    }
  }

  // refresh impl-diff.json (same shape the editor badge reads); never touch last-ai/pending
  const after = implDiff({ src });
  writeJSON(artisanDir('impl-diff.json'), {
    changed: !!(after.res.added.length || after.res.removed.length || after.res.modified.length),
    counts: { missing: after.res.removed.length, drift: after.res.added.length, mismatch: after.res.modified.length },
    t: new Date().toISOString(),
  });
  const leftovers = new Set(out.agent);
  for (const r of after.res.removed) leftovers.add(`still missing from code: ${r.type === 'class' ? r.name : r.what || r.name}`);
  for (const r of after.res.added) leftovers.add(`still in code, not in diagram: ${r.type === 'class' ? r.name : r.what || r.name}`);
  for (const r of after.res.modified) leftovers.add(`still mismatched: ${r.ref}`);
  for (const r of after.res.renames) leftovers.add(`rename not applied: ${r.to} → ${r.from}`);
  out.agent = [...leftovers];

  const summary =
    [out.created.length && `${out.created.length} created`, out.renamed.length && `${out.renamed.length} renamed`, out.moved.length && `${out.moved.length} moved`, out.patched.length && `${out.patched.length} patched`, out.removed.length && `${out.removed.length} removed`]
      .filter(Boolean)
      .join(', ') || 'nothing to change';
  appendLog('scaffold', summary);

  if (json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`# Scaffold report — ${summary}`);
    const sections = [['Created', out.created], ['Renamed', out.renamed], ['Moved', out.moved], ['Patched', out.patched], ['Removed', out.removed], ['Skipped', out.skipped]];
    for (const [title, items] of sections) {
      if (!items.length) continue;
      console.log(`\n## ${title}`);
      for (const item of items) console.log(`- ${item}`);
    }
    if (out.agent.length) {
      console.log('\n## For the agent');
      for (const item of out.agent) console.log(`- ${item}`);
    }
  }
  return out;
}
