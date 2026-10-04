import { CilError } from '../../binary.js';
import { decodeCoded } from '../../metadata/indices.js';
import { rejectTypeSystem } from './results.js';

export function hierarchyIndex(kind, value) {
  try { return decodeCoded(kind, value); } catch (error) {
    if (!(error instanceof CilError)) throw error;
    rejectTypeSystem('CILVT0001', error.message);
  }
}

export function checkedToken(token, counts, tables = [1, 2, 27]) {
  if (!Number.isInteger(token) || token < 0 || token > 0xffffffff) rejectTypeSystem('CILVT0001', 'type token');
  const table = token >>> 24;
  const row = token & 0xffffff;
  if (!tables.includes(table) || !row || row > (counts[table] ?? 0)) rejectTypeSystem('CILVT0001', 'type token extent');
  return token;
}

