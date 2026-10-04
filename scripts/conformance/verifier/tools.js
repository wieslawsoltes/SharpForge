import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { root, sha256, pin } from '../oracle/toolchain.js';
import { readJSON } from './catalog.js';

export const verifierPin = await readJSON(path.join(root, 'planning/qualification/verifier/ilverify-pin.json'));

/** Tools are explicit, externally provisioned prerequisites; this module never downloads or installs them. */
export async function checkTools({ ilasm, ilverify, ilasmPins } = {}) {
  if (!ilasm || !ilverify) return { supported: false, reason: 'Set SHARPFORGE_ILASM and SHARPFORGE_ILVERIFY to pinned tools.' };
  const pinFile = ilasmPins ?? path.join(root, 'planning/qualification/suites/ilasm-pins.json');
  const pins = await readJSON(pinFile);
  if (pins.version !== pin.runtime) throw new Error('ILAsm version differs from oracle runtime pin');
  const rid = `${{ darwin: 'osx', win32: 'win' }[process.platform] ?? process.platform}-${process.arch}`;
  const assemblerPin = pins.platforms.find(row => row.rid === rid);
  if (!assemblerPin) return { supported: false, reason: `No ILAsm pin for ${rid}` };
  if (sha256(await readFile(ilasm)) !== assemblerPin.sha256) throw new Error('ILAsm binary hash mismatch');
  if (path.basename(ilverify) !== verifierPin.entry) throw new Error('ILVerify path must name the pinned managed entry point');
  for (const file of verifierPin.files) {
    if (sha256(await readFile(path.join(path.dirname(ilverify), file.path))) !== file.sha256) {
      throw new Error(`ILVerify file hash mismatch: ${file.path}`);
    }
  }
  return { supported: true, ilasm, ilverify, assemblerPin, verifierPin };
}
