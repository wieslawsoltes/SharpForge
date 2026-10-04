import {conversionMatrixSource} from '../../tests/support/numeric-conversion-matrix.js';
import {numericDifferential} from '../../tests/support/numeric-differential.js';
import {conversionDigest} from './conversion-proof.js';

/** Replay every saved native answer through the existing three-route differential engine. */
export function replayConversionCapture(cases, output, recordChunk = () => {}) {
  const lines = output.split('\n');
  lines.pop();
  const totals = new Map();
  const chunks = [];
  for (let offset = 0; offset < cases.length; offset += 48) {
    const operands = cases.slice(offset, offset + 48);
    const source = 'using System;\n' + operands.map(conversionMatrixSource).join('\n');
    const expected = lines.slice(offset, offset + operands.length).join('\n') + '\n';
    const row = {offset, cases: operands.length, sourceSha256: conversionDigest(source), status: 'running'};
    let artifacts = {source, expected};
    recordChunk(row, artifacts);
    let result;
    try {
      result = numericDifferential(source, expected, {nativeIntBits: operands[0].nativeIntBits,
        family: 'native conversion ABI' + operands[0].nativeIntBits, operands: operands.map(item => item.id).join(', '),
        onAssembly(assembly) {
          artifacts = {...artifacts, assembly};
          row.assemblySha256 = conversionDigest(assembly);
          recordChunk(row, artifacts);
        }});
    } catch (error) {
      recordChunk({...row, status: 'failed', error: {name: error.name, message: error.message}}, artifacts);
      throw error;
    }
    Object.assign(row, {status: 'passed', routes: result.outputs});
    recordChunk(row, artifacts);
    chunks.push(row);
    for (const [engine, measured] of Object.entries(result.outputs)) {
      const total = totals.get(engine) ?? {engine, cases: 0, instructions: 0, characters: 0};
      total.cases += operands.length;
      total.instructions += measured.instructions;
      total.characters += measured.characters;
      totals.set(engine, total);
    }
  }
  return {chunks, routes: [...totals.values()].map(row => ({...row, outputSha256: conversionDigest(output)}))};
}
