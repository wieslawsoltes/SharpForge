import { loadError, LoadErrorCode } from '../load-errors.js';

const empty = Object.freeze([]);
const none = Object.freeze({ required: empty, optional: empty });

/** Read only the outer modifier prefix, returning frozen unresolved tokens in CoreCLR reflection order. */
export function readCustomModifierTokens(type, module) {
  if (!type || typeof type !== 'object') throw loadError(LoadErrorCode.InvalidImage, 'Missing custom modifier signature type');
  if (type.kind !== 'modreq' && type.kind !== 'modopt') return none;
  const required = [], optional = [];
  let count = 0;
  while (type.kind === 'modreq' || type.kind === 'modopt') {
    if (++count > 64) throw loadError(LoadErrorCode.LimitExceeded, 'Custom modifier prefix limit exceeded');
    const token = type.token;
    if (!Number.isInteger(token) || token < 0 || token > 0xffffffff) {
      throw loadError(LoadErrorCode.InvalidImage, 'Invalid custom modifier type token');
    }
    const table = token >>> 24;
    const row = token & 0xffffff;
    if ((table !== 1 && table !== 2 && table !== 27) || !row || row > module.rowCount(table)) {
      throw loadError(LoadErrorCode.InvalidImage, 'Invalid custom modifier type token');
    }
    (type.kind === 'modreq' ? required : optional).push(token);
    type = type.element;
    if (!type || typeof type !== 'object') throw loadError(LoadErrorCode.InvalidImage, 'Missing custom modifier element');
  }
  // CoreCLR fills each modifier array from the end while scanning the encoded prefix.
  return Object.freeze({
    required: required.length ? Object.freeze(required.reverse()) : empty,
    optional: optional.length ? Object.freeze(optional.reverse()) : empty,
  });
}
