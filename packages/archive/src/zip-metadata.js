import { zipError } from './zip-budgets.js';
import { zipView } from './zip64.js';

/** Dates are UTC milliseconds; Unix modes contain permission and regular-file type bits. */
export function readZipMetadata({ made, attrs, dosTime, dosDate, fields, directory }) {
  const unix = made >>> 8 === 3;
  const mode = attrs >>> 16;
  if (unix && mode & 0xf000 && ![0x4000, 0x8000].includes(mode & 0xf000)) {
    zipError('SFZIP010', 'Links and special files are not accepted');
  }
  const year = 1980 + (dosDate >>> 9);
  const month = (dosDate >>> 5) & 15;
  const day = dosDate & 31;
  let mtime = Date.UTC(year, Math.max(1, month) - 1, Math.max(1, day), dosTime >>> 11, (dosTime >>> 5) & 63, (dosTime & 31) * 2);
  const timestamp = fields.get(0x5455);
  if (timestamp) {
    if (!timestamp.length || timestamp[0] & 1 && timestamp.length < 5) zipError('SFZIP008', 'Malformed ZIP timestamp');
    if (timestamp[0] & 1) mtime = zipView(timestamp).getUint32(1, true) * 1000;
  }
  return { mtime, mode: unix && mode ? mode : directory ? 0x41ed : 0x81a4 };
}

export function writeZipMetadata(file, { preserveMetadata = false } = {}) {
  if (!preserveMetadata) return { dosDate: 33, dosTime: 0, mode: file.directory ? 0x41ed : 0x81a4, extra: new Uint8Array() };
  const mtime = preserveMetadata && file.mtime !== undefined ? Number(file.mtime) : Date.UTC(1980, 0, 1);
  if (!Number.isFinite(mtime) || mtime < 0 || mtime / 1000 > 0xffffffff) zipError('SFZIP010', 'Unsupported ZIP timestamp');
  const date = new Date(mtime);
  const year = Math.max(1980, Math.min(2107, date.getUTCFullYear()));
  const dosDate = (year - 1980) << 9 | (date.getUTCMonth() + 1) << 5 | date.getUTCDate();
  const dosTime = date.getUTCHours() << 11 | date.getUTCMinutes() << 5 | (date.getUTCSeconds() >>> 1);
  const type = file.directory ? 0x4000 : 0x8000;
  let mode = type | (file.directory ? 0o755 : 0o644);
  if (preserveMetadata && file.mode !== undefined) {
    if (!Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0xffff) zipError('SFZIP010', 'Invalid Unix mode');
    if (file.mode & 0xf000 && (file.mode & 0xf000) !== type) zipError('SFZIP010', 'Links and special files are not accepted');
    mode = type | (file.mode & 0o777);
  }
  const extra = new Uint8Array(preserveMetadata ? 9 : 0);
  if (extra.length) {
    const view = zipView(extra);
    view.setUint16(0, 0x5455, true);
    view.setUint16(2, 5, true);
    extra[4] = 1;
    view.setUint32(5, Math.floor(mtime / 1000), true);
  }
  return { dosDate, dosTime, mode, extra };
}
