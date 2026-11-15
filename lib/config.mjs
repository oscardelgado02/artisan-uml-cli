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

// Shared relative-path rule (scaffoldDir, --dir): root-relative, '/'-joined.
// Absolute paths inside the root become relative; absolute paths outside it
// or ".." escapes are rejected. '' clears. Per-node dirs validate against the
// scaffold root by passing { root: scaffoldRoot }.
export function normalizeProjectDir(raw, { root = process.cwd(), label = 'project root' } = {}) {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  s = s.replace(/\\/g, '/').replace(/\/+$/, '');
  const abs = path.isAbsolute(s) || /^[A-Za-z]:[\\/]/.test(s);
  const rel = path.relative(root, abs ? s : path.resolve(root, s));
  if (!rel || rel === '.') return '.';
  if (rel.startsWith('..') || path.isAbsolute(rel))
    throw new Error(`directory must stay inside the ${label}`);
  return rel.split(path.sep).join('/');
}

// Join a default (scaffold) dir with a default-dir-relative node dir —
// both project-root-relative ('.' = project root). Returns project-relative.
export function joinProjectDir(defaultDir, rel) {
  if (!rel || rel === '.') return defaultDir;
  if (!defaultDir || defaultDir === '.') return rel;
  return `${defaultDir}/${rel}`;
}

// One-time semantics migration: per-node dirs were project-root-relative
// ("src/Combat"); they are now relative to the default (scaffold) dir
// ("Combat"). Strips the prefix only when the file on disk agrees it really
// lives in that dir; '.' and a bare default-dir value clear to unset.
export function migrateNodeDir(dir, defaultDir, diskDir) {
  if (!dir) return undefined;
  if (dir === '.') return undefined; // legacy "root" marker → default dir
  if (defaultDir === '.') return dir; // same base as before — nothing to strip
  if (dir === defaultDir) return undefined;
  if (!dir.startsWith(`${defaultDir}/`)) return dir; // no prefix — kept, re-resolves under the default dir
  // keep the typed value only when the file on disk really sits in
  // defaultDir + dir (typed under the new rule); otherwise it's legacy
  // project-root-relative storage → strip the prefix
  if (diskDir && diskDir === joinProjectDir(defaultDir, dir)) return dir;
  return dir.slice(defaultDir.length + 1) || undefined;
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
