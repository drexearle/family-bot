'use strict';
/*
 * load-env.js — tiny zero-dependency .env loader.
 * Reads KEY=VALUE lines from ./.env (next to this file) into process.env,
 * without overwriting variables already set on the command line.
 * require('./load-env') at the very top of an entrypoint, before reading env.
 */
const fs = require('fs');
const path = require('path');
try {
  const txt = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (let line of txt.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (key && !(key in process.env)) process.env[key] = val;
  }
} catch { /* no .env file — that's fine, use real env vars or defaults */ }
module.exports = {};
