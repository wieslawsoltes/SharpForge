import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2]);
const fixtures = resolve(process.argv[3]);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const { target } = await import(pathToFileURL(resolve(root, 'scripts/conformance/fuzz/targets/bytecode-image.js')));
const { deserializeImage, verifyImage } = await import(pathToFileURL(resolve(root, 'packages/bytecode/src/index.js')));
const { bytecodeSeeds } = await import(pathToFileURL(resolve(fixtures, 'scripts/conformance/fuzz/targets/bytecode-seeds.js')));
const source = { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), clean: git('status', '--porcelain') === '' };
const cases = bytecodeSeeds().map(seed => ({
  name: seed.name, inputSha256: createHash('sha256').update(seed.input).digest('hex'),
  verification: verifyImage(deserializeImage(new TextDecoder().decode(seed.input))),
  outcome: target.run(seed.input, { maxInputBytes: 65536, maxOutputBytes: 65536 }),
}));
console.log(JSON.stringify({ schemaVersion: 1, source, fixtures: { commit: execFileSync('git', ['rev-parse', 'HEAD'],
  { cwd: fixtures, encoding: 'utf8' }).trim() }, cases }, null, 2));
