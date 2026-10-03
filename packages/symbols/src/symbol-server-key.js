import { fail, guidString } from './contracts.js';

function filename(path) {
  if (typeof path !== 'string' || path.length > 32768) fail('Invalid symbol file path');
  const name = Array.from(path.replaceAll('\\', '/').split('/').at(-1), (character) => {
    const lower = character.toLowerCase();
    return lower.length === character.length ? lower : character;
  }).join('');
  if (!name || name === '.' || name === '..' || name.length > 1024 || /[\u0000-\u001f\u007f]/.test(name)) {
    fail('Invalid symbol file name');
  }
  try {
    encodeURIComponent(name);
  } catch {
    fail('Invalid Unicode in symbol file name');
  }
  return name;
}

/** Build the SSQP Portable PDB key from its complete 20-byte #Pdb identity; the key uses only the GUID. */
export function portablePdbKey(path, id) {
  if (!(id instanceof Uint8Array) || id.length !== 20) fail('Portable PDB identity must contain 20 bytes');
  const name = filename(path);
  const signature = guidString(id.subarray(0, 16)).replaceAll('-', '');
  return `${name}/${signature}FFFFFFFF/${name}`;
}

/** Build the SSQP PE key from unsigned COFF timestamp and SizeOfImage values. */
export function peSymbolKey(path, identity = {}) {
  const timestamp = identity?.timestamp,
    sizeOfImage = identity?.sizeOfImage;
  if (
    !Number.isInteger(timestamp) ||
    timestamp < 0 ||
    timestamp > 0xffffffff ||
    !Number.isInteger(sizeOfImage) ||
    sizeOfImage <= 0 ||
    sizeOfImage > 0xffffffff
  ) {
    fail('Invalid PE symbol identity');
  }
  const name = filename(path);
  const signature = timestamp.toString(16).toUpperCase().padStart(8, '0') + sizeOfImage.toString(16);
  return `${name}/${signature}/${name}`;
}

export function keyUrl(server, key) {
  const escaped = key
    .split('/')
    .map((part) =>
      encodeURIComponent(part).replace(
        /[!'()*]/g,
        (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase(),
      ),
    )
    .join('/');
  return new URL(escaped, server).href;
}
