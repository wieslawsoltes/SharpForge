import { CilError, readPE } from '@sharpforge/cil';
import { boundsCase, caseIds } from './input.mjs';

/** Browser source replay; native capture and input execution remain separate qualification targets. */
export function run() {
  let checked = 0;
  for (const platform of ['anycpu', 'x64']) for (const id of caseIds) {
    const fixture = boundsCase(id, platform);
    let accepted = false;
    try {
      const pe = readPE(fixture.bytes);
      if (pe.imageKind !== 'ILOnly') throw new Error('Unexpected image classification');
      accepted = true;
    } catch (error) {
      if (!(error instanceof CilError)) throw error;
    }
    if (accepted !== fixture.accepted) throw new Error('PE bounds mismatch: ' + platform + ':' + id);
    checked++;
  }
  return { checked, nativeCapture: 'not-run', inputExecution: 'not-run' };
}
