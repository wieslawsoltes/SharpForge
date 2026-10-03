import {existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';

// Execute npm with Node directly: Windows .cmd launchers cannot be passed to
// spawnSync without a shell, and package/path arguments must remain literal.
export function npmCli() {
  return [process.env.npm_execpath,
    resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')]
    .find(path => path && existsSync(path));
}
