import { zipError } from './zip-budgets.js';

export function sameZipBytes(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
  return true;
}

function zipSignature(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  return bytes[2] === 3 && bytes[3] === 4 || bytes[2] === 5 && bytes[3] === 6 || bytes[2] === 6 && bytes[3] === 6;
}

/** Nested files stay inert by default. Explicit rejection is useful when a consumer may otherwise recursively unpack them. */
export function checkNestedZip(bytes, path, policy) {
  if (policy === 'reject' && zipSignature(bytes)) zipError('SFZIP014', 'Nested ZIP payload rejected by policy: ' + path);
}

/** Only an exact byte match is a direct quine: no filename or CRC-only heuristic rejects an ordinary equal-size file. */
export function rejectZipQuine(matches, path) {
  if (matches) zipError('SFZIP014', 'Self-reproducing ZIP entry rejected: ' + path);
}
