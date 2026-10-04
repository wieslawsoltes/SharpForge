import { readFileSync } from 'node:fs';
import { fixtures } from '../test/differential/fixtures/module-initialization.js';
import { moduleBenchmarkHash } from './module-startup-benchmark-measure.js';

const controls = [
  {
    name: 'no-initializers', expected: 'main\n', pinHash: '99ed604be73237cf',
    sourceSha256: 'd318760651415c1cd211eac83f3631eed9e76c709bb7e520a7cbce97a30478d4',
  },
  {
    name: 'plain-main', expected: 'module\nmain\n', pinHash: '625f09315547306c',
    sourceSha256: 'be237cb30df6b70483957ab3e6c8fbe2e647915e075e075fc0b0bb5060afd020',
  },
];

/** Only the two unchanged controls whose pre-fix output is correct; exact source/pin identity precedes measurement. */
export function moduleStartupWorkloads() {
  const pinBytes = readFileSync(new URL('../test/differential/pinned/module-initialization.json', import.meta.url));
  const pins = JSON.parse(pinBytes.toString('utf8'));
  const workloads = controls.map(control => {
    const id = 'module-initialization/' + control.name;
    const fixture = fixtures.find(fixture => fixture.id === id);
    const pin = pins.fixtures[id];
    if (!fixture || moduleBenchmarkHash(fixture.source) !== control.sourceSha256)
      throw new Error(`${id}: the benchmark control source changed; qualify and review the new source first`);
    if (pin?.hash !== control.pinHash || pin.kind !== 'output' || pin.output !== control.expected || pin.exception
      || pin.diagnostics.some(diagnostic => diagnostic[3] === 'error'))
      throw new Error(`${id}: the independent Roslyn output pin is absent or changed`);
    return {
      ...control, id, source: fixture.source, langVersion: pin.langVersion, sourceBytes: Buffer.byteLength(fixture.source),
    };
  });
  return { workloads, reference: { roslyn: pins.roslyn, pinSha256: moduleBenchmarkHash(pinBytes) } };
}
