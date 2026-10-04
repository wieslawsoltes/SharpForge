import { displayNamePieces } from './assembly-display-name.js';

const maximumDeclarations = 4096;
const maximumDeclarationLength = 16384;

function friendIdentity(text) {
  if (typeof text !== 'string' || text.length > maximumDeclarationLength || /[\u0000-\u001f]/.test(text)) return null;
  const pieces = displayNamePieces(text);
  if (!pieces) return null;
  const parts = pieces.map(part => part.trim());
  const name = parts.shift();
  if (!name) return null;
  let publicKey = '';
  for (const part of parts) {
    // IVT names have an optional full public key, never a version, culture, or public-key token.
    const match = /^PublicKey\s*=\s*([0-9a-f]+)$/i.exec(part);
    if (!match || publicKey || match[1].length % 2) return null;
    publicKey = match[1].toLowerCase();
  }
  return { name: name.toLowerCase(), publicKey };
}

/**
 * Whether a bounded InternalsVisibleTo declaration list grants access to the supplied assembly identity.
 * Names compare case-insensitively. A signed friend must supply its full publicKey, not a publicKeyToken.
 * Malformed declarations, excessive input, and invalid identities fail closed and return false.
 */
export function grantsInternalsAccess(declarations, identity) {
  if (!Array.isArray(declarations) || declarations.length > maximumDeclarations
    || typeof identity?.name !== 'string' || !identity.name || identity.name.length > 1024) return false;
  const name = identity.name.toLowerCase();
  const publicKey = typeof identity.publicKey === 'string' ? identity.publicKey.toLowerCase() : '';
  return declarations.some(text => {
    const friend = friendIdentity(text);
    return friend?.name === name && (!friend.publicKey || friend.publicKey === publicKey);
  });
}
