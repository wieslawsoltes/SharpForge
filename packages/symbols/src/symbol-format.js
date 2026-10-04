import { SymbolError } from './contracts.js';

const formats = [
  ['Microsoft C/C++ MSF 7.00', 'Windows PDB (MSF 7.00)'],
  ['Microsoft C/C++ program database 2.00', 'Windows PDB (MSF 2.00)'],
  ['NB09', 'legacy embedded CodeView NB09'],
  ['NB10', 'legacy embedded CodeView NB10'],
  ['NB11', 'legacy embedded CodeView NB11'],
];

function startsWith(bytes, signature) {
  return bytes.length >= signature.length && [...signature].every((character, index) => bytes[index] === character.charCodeAt(0));
}

export function rejectUnsupportedSymbolFormat(bytes) {
  for (const [signature, format] of formats) {
    if (startsWith(bytes, signature)) {
      throw new SymbolError('Unsupported symbol format: ' + format, { code: 'SF_SYMBOL_UNSUPPORTED_FORMAT', format });
    }
  }
}
