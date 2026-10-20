// Project + global config, merged (project wins).
// Keys today: askBeforeRemove (bool, default true), autoServe (bool, default false).
// scan seeds .artisan/config.json with defaults when absent so teams discover it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { artisanDir, readJSON, writeJSON } from './store.mjs';

export const CONFIG_DEFAULTS = {
  askBeforeRemove: true,
  autoServe: false,
};

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
