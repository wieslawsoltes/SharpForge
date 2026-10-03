import { Reader, text, decodeCoded } from '@sharpforge/cil';
import { fail } from './contracts.js';
export function readImports(bytes, md) {
  const r = new Reader(bytes),
    result = [];
  const name = () => text(md.blob(r.compressed()));
  while (r.position < r.end) {
    if (result.length > 100000) fail('Import limit exceeded');
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
  }
  return result;
}
