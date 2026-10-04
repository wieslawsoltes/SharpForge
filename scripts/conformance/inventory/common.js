import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { root, pin, sha256, readJSON } from '../oracle/toolchain.js';

export { root, pin, sha256, readJSON };
export const inventoryRoot = path.join(root, 'planning/qualification/inventory');
export const probeRoot = path.join(root, 'tests/conformance/inventory/probes');
export const artifactRoot = path.resolve(root, process.env.SHARPFORGE_RESULTS_DIR || 'artifacts/results', 'inventory');
export const platforms = ['browser-chromium', 'browser-firefox', 'browser-webkit', 'node-linux-x64', 'node-win32-x64', 'node-darwin-arm64'];
export const vmEngines = ['js-source-vm', 'js-cil-vm'];
// One row per line keeps large reference diffs reviewable without expanding
// every repeated field into many lines.
export const canonicalJSON = value => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const key = ['rows','entries','issues','files'].find(k=>Array.isArray(value[k]));
    if (key) { const { [key]: rows, ...header } = value; return JSON.stringify(header).slice(0,-1) + (Object.keys(header).length ? ',' : '') + `"${key}":[\n` + rows.map(row=>JSON.stringify(row)).join(',\n') + '\n]}\n'; }
  }
  return `${JSON.stringify(value)}\n`;
};

export async function writeJSON(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, canonicalJSON(value));
}
export async function sourceFile(relative) {
  const bytes = await readFile(path.join(root, relative));
  return { path: relative, sha256: sha256(bytes), text: bytes.toString('utf8') };
}

export function counts(rows) {
  const statuses = {};
  for (const row of rows) statuses[row.status] = (statuses[row.status] ?? 0) + 1;
  return { denominator: rows.length, statuses, parity: 'not calculated: inventory presence/smoke probes are not verified behavior' };
}

export function normalizeType(value) {
  const aliases = { 'System.Void': 'void', 'System.Boolean': 'bool', 'System.Char': 'char', 'System.SByte': 'sbyte', 'System.Byte': 'byte', 'System.Int16': 'short', 'System.UInt16': 'ushort', 'System.Int32': 'int', 'System.UInt32': 'uint', 'System.Int64': 'long', 'System.UInt64': 'ulong', 'System.Single': 'float', 'System.Double': 'double', 'System.String': 'string', 'System.Object': 'object', 'System.IntPtr': 'nint', 'System.UIntPtr': 'nuint' };
  return value.replace(/System\.[A-Za-z][A-Za-z0-9]*/g, word => aliases[word] ?? word).replaceAll(', ', ',');
}

export function signatureKey(row, { requireHeader = false } = {}) {
  const key = [row.owner, row.name, row.isStatic ? 'static' : 'instance', row.genericArity ?? 0,
    row.parameters.map(normalizeType).join(','), normalizeType(row.name === '.ctor' ? 'System.Void' : row.result)].join('|');
  if (!Object.hasOwn(row, 'signatureHeader')) {
    // Historical native rows omitted this evidence; they cannot establish an exact match.
    if (requireHeader) throw new TypeError('Native method signature header unavailable; historical metadata requires recapture');
    return key; // Existing registry contracts describe ordinary managed methods.
  }
  const header = row.signatureHeader;
  if (!Number.isInteger(header) || header < 0 || header > 255) throw new TypeError('Method signature header must be a byte');
  const ordinaryHeader = (row.isStatic ? 0 : 0x20) | ((row.genericArity ?? 0) > 0 ? 0x10 : 0);
  return header === ordinaryHeader ? key : `${key}|header=0x${header.toString(16).toUpperCase().padStart(2, '0')}`;
}
