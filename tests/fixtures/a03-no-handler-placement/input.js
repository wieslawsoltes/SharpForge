import { managedFixture } from '../../managed-fixtures.js';

/** Independent CIL bodies with no exception clauses; placement is not produced by the verifier. */
export function placementFixture({ opcode = 'ret', unreachable = false } = {}) {
  let sourceOffset;
  const bytes = managedFixture({ name: 'NoHandlerPlacement', methods: [{ name: 'Main', body(writer) {
    if (unreachable) writer.op('br', 'done');
    if (opcode === 'endfilter') writer.op('ldc.i4.0');
    if (opcode === 'throw') writer.op('ldnull');
    if (opcode === 'branch') writer.op('br', 'done');
    else writer.mark('source').op(opcode);
    writer.mark('done').op('ret');
    sourceOffset = writer.labels.get('source');
  } }] });
  return { bytes, sourceOffset };
}

export const nativeCases = [
  ...['ret', 'throw', 'branch'].map(opcode => ({ name: opcode, options: { opcode }, accepted: true })),
  ...[
    ['rethrow', 'CILCF0001', 'Rethrow'],
    ['endfinally', 'CILCF0004', 'Endfinally'],
    ['endfilter', 'CILCF0005', 'Endfilter'],
  ].map(([opcode, diagnostic, nativeError]) => ({ name: opcode, options: { opcode }, accepted: false, diagnostic, nativeError })),
];
