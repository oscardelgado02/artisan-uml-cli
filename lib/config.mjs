// Project + global config, merged (project wins).
// Keys today: askBeforeRemove (bool, default true), autoServe (bool, default
// false), scaffoldDir (fallback directory for `artuml scaffold` creations,
// default '' = the scan root), stubBody (throw|empty|todo).
// scan seeds .artisan/config.json with defaults when absent so teams discover it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { artisanDir, readJSON, writeJSON } from './store.mjs';

export const CONFIG_DEFAULTS = {
  askBeforeRemove: true,
  autoServe: false,
  scaffoldDir: '',
  stubBody: 'throw',
};
const STUB_BODIES = new Set(['throw', 'empty', 'todo']);

// Shared relative-path rule (node.dir, scaffoldDir, --dir): project-root-
// relative, '/'-joined. Absolute paths inside the root become relative;
// absolute paths outside it or ".." escapes are rejected. '' clears.
export function normalizeProjectDir(raw, { root = process.cwd() } = {}) {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  s = s.replace(/\\/g, '/').replace(/\/+$/, '');
  const abs = path.isAbsolute(s) || /^[A-Za-z]:[\\/]/.test(s);
  const rel = path.relative(root, abs ? s : path.resolve(root, s));
  if (!rel || rel === '.') return '.';
  if (rel.startsWith('..') || path.isAbsolute(rel))
    throw new Error(`directory must stay inside the project root`);
  return rel.split(path.sep).join('/');
}

// Validate + set one key in the project config. Returns the stored value.
export function setConfigKey(key, value) {
  if (!(key in CONFIG_DEFAULTS)) throw new Error(`Unknown config key "${key}" — one of: ${Object.keys(CONFIG_DEFAULTS).join(', ')}`);
  let v = value;
  if (key === 'stubBody') {
    v = String(v);
    if (!STUB_BODIES.has(v)) throw new Error(`stubBody must be one of: ${[...STUB_BODIES].join(', ')}`);
  } else if (key === 'scaffoldDir') {
    v = normalizeProjectDir(v);
  } else {
    if (typeof v === 'string') {
      if (v === 'true') v = true;
      else if (v === 'false') v = false;
    }
    if (typeof v !== 'boolean') throw new Error(`${key} must be true or false`);
  }
  const p = artisanDir('config.json');
  const cfg = readJSON(p) || { ...CONFIG_DEFAULTS };
  cfg[key] = v;
  writeJSON(p, cfg);
  return v;
}

function globalConfigPath() {
  return path.join(os.homedir(), '.config', 'artuml', 'config.json');
}

function mergeConfig(base, extra) {
  const out = { ...base };
  for (const k of Object.keys(CONFIG_DEFAULTS)) {
    if (extra && typeof extra[k] !== 'undefined') out[k] = extra[k];
  }
  return out;
}

export function ensureProjectConfig() {
  const p = artisanDir('config.json');
  if (!readJSON(p)) writeJSON(p, CONFIG_DEFAULTS);
}

// Reads and merges; missing files fall through to defaults. Never writes.
export function loadConfig() {
  const global = readJSON(globalConfigPath());
  const project = readJSON(artisanDir('config.json'));
  return mergeConfig(mergeConfig(CONFIG_DEFAULTS, global), project);
}
