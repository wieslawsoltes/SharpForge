import { Reader, text, decodeCoded } from '@sharpforge/cil';
import { fail } from './contracts.js';
export function readImports(bytes, md, budget = { entries: 0, bytes: 0 }) {
  const r = new Reader(bytes),
    result = [];
  const name = () => {
    const bytes = md.blob(r.compressed());
    if (bytes.length > 4096 || (budget.bytes += bytes.length) > 4 * 1024 * 1024)
      fail('Import name byte limit exceeded');
    return text(bytes);
  };
  while (r.position < r.end) {
    if (++budget.entries > 100000) fail('Import definition count limit exceeded');
    const kind = r.compressed(),
      d = { kind };
    switch (kind) {
      case 1:
        d.namespace = name();
        break;
      case 2:
        d.assembly = r.compressed();
        d.namespace = name();
        break;
      case 3:
        d.type = decodeCoded('TypeDefOrRef', r.compressed());
        break;
      case 4:
        d.alias = name();
        d.namespace = name();
        break;
      case 5:
        d.alias = name();
        break;
      case 6:
        d.alias = name();
        d.assembly = r.compressed();
        break;
      case 7:
        d.alias = name();
        d.namespace = name();
        break;
      case 8:
        d.alias = name();
        d.assembly = r.compressed();
        d.namespace = name();
        break;
      case 9:
        d.alias = name();
        d.type = decodeCoded('TypeDefOrRef', r.compressed());
        break;
      default:
        fail('Unknown import definition kind');
    }
    result.push(d);
    if (d.assembly !== undefined && (!d.assembly || d.assembly > (md.externalCounts[35] ?? 0)))
      fail('Invalid import assembly reference');
    if (d.type !== undefined && (!(d.type & 0xffffff) || (d.type & 0xffffff) > (md.externalCounts[d.type >>> 24] ?? 0)))
      fail('Invalid import type reference');
  }
  return result;
}
