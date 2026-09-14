// .artisan folder layout, JSON IO, shared diagram helpers.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DIR = '.artisan';

export const artisanPath = (p) => path.join(DIR, p);

export function artisanDir(p) {
  return artisanPath(p);
}

export function ensureDir(dir = DIR) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function writeJSON(p, data) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

// Deterministic id from a string — stable across scans so human positions/notes survive.
export function hid(s) {
  const h = crypto.createHash('sha1').update(s).digest('base64url');
  return 'c' + h.slice(0, 10).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export const uid = () => 'e' + crypto.randomBytes(6).toString('hex');

// Diagram shape (shared with the editor's SerializedDiagram):
// { seq, nodes:[{id,kind,name,x,y,attributes,methods,note?}], edges:[...], projectNotes? }

export function normalizeDiagram(d) {
  d = d && typeof d === 'object' ? d : {};
  d.seq = typeof d.seq === 'number' ? d.seq : 1;
  d.nodes = Array.isArray(d.nodes) ? d.nodes : [];
  d.edges = Array.isArray(d.edges) ? d.edges : [];
  for (const n of d.nodes) {
    n.attributes = Array.isArray(n.attributes) ? n.attributes : [];
    n.methods = Array.isArray(n.methods) ? n.methods : [];
  }
  return d;
}

export function diagramSummary(d) {
  const names = d.nodes.map((n) => n.name).filter(Boolean);
  return `${d.nodes.length} types (${names.slice(0, 5).join(', ')}${names.length > 5 ? ', …' : ''})`;
}
