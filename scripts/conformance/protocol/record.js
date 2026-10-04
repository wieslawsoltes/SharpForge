/** Transparent framed stdio proxy; no fabricated messages or client actions. */
import {spawn} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {ProtocolMessageReader} from '../../../packages/protocol/src/framing.js';
import {git} from '../../planning/lib/io.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const {values} = parseArgs({options: {protocol: {type: 'string'}, output: {type: 'string'}, 'client-version': {type: 'string'}}});
if (!['lsp', 'dap'].includes(values.protocol) || !values.output || !values['client-version']) throw new Error('Recorder requires --protocol lsp|dap --output PATH --client-version VERSION');
const session = {schemaVersion: 1, protocol: values.protocol, kind: 'recording', complete: false,
  client: {name: 'Visual Studio Code', version: values['client-version']},
  capture: {tool: 'sharpforge-stdio-recorder', serverCommit: git(['rev-parse', 'HEAD'], root).trim(), startedAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`, node: process.versions.node}, messages: []};
const child = spawn(process.execPath, [resolve(root, `packages/protocol/bin/sharpforge-${values.protocol}.js`)], {cwd: root, stdio: ['pipe', 'pipe', 'pipe']});
const readers = {clientToServer: new ProtocolMessageReader(), serverToClient: new ProtocolMessageReader()};
let total = 0, terminal = false, failure = null;
const fail = error => { failure ??= error.message; child.kill('SIGKILL'); };
function record(bytes, direction) {
  total += bytes.length; if (total > 32 * 1024 * 1024) throw new Error('Recording limit exceeded');
  for (const message of readers[direction].feed(bytes)) {
    if (session.messages.length >= 10000) throw new Error('Recording message limit exceeded');
    session.messages.push({direction, message});
    if (values.protocol === 'lsp' && direction === 'clientToServer' && message.method === 'exit') terminal = true;
    if (values.protocol === 'dap' && direction === 'serverToClient' && message.command === 'disconnect' && message.success === true) terminal = true;
  }
}
process.stdin.on('data', bytes => { try { record(bytes, 'clientToServer'); if (!child.stdin.write(bytes)) process.stdin.pause(); } catch (error) { fail(error); } });
child.stdin.on('drain', () => process.stdin.resume()); process.stdin.on('end', () => child.stdin.end());
child.stdout.on('data', bytes => { try { record(bytes, 'serverToClient'); if (!process.stdout.write(bytes)) child.stdout.pause(); } catch (error) { fail(error); } });
process.stdout.on('drain', () => child.stdout.resume()); child.stderr.pipe(process.stderr);
for (const stream of [process.stdin, process.stdout, child.stdin, child.stdout]) stream.on('error', fail);
child.on('error', fail);
const timeout = setTimeout(() => fail(new Error('Recording exceeded 30 minutes')), 30 * 60 * 1000);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('close', async (code, signal) => {
  clearTimeout(timeout);
  for (const reader of Object.values(readers)) try { reader.finish(); } catch (error) { failure ??= error.message; }
  session.complete = terminal && !failure && (code === 0 || values.protocol === 'dap' && signal === 'SIGTERM'); session.capture.exitCode = code; session.capture.signal = signal; session.capture.error = failure;
  await mkdir(dirname(resolve(values.output)), {recursive: true}); await writeFile(values.output, JSON.stringify(session, null, 2) + '\n');
  process.stdin.destroy(); process.exitCode = failure ? 1 : code ?? 0;
});
