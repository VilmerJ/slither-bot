import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Load project-local secrets only; an explicitly exported variable wins.
export function loadEnv(path = '.env', target = process.env) {
  let text;
  try { text = readFileSync(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (target[key] === undefined) target[key] = value;
  }
}
