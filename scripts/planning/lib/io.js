import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
export const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
export function writeJSON(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); }
export const isMain = url => process.argv[1] && url === pathToFileURL(process.argv[1]).href;
export function git(args, cwd = process.cwd()) { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr || r.error?.message || 'git failed'); return r.stdout; }
export function report(result) { console.log(JSON.stringify(result, null, 2)); if (result.errors?.length) process.exitCode = 1; }
