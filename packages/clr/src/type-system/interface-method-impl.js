import { decodeCoded, decodeSignature } from '@sharpforge/cil';
import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';

const invalid = message => loadError(LoadErrorCode.InvalidImage, message);
const unsupported = message => loadError(LoadErrorCode.TypeLoad, message);

/** Classify interface-only mappings; class MethodImpl slot replacement remains a separate service. */
export class InterfaceMethodImplementations {
  #loader;
  #maxRows;
  #modules = new WeakMap();
  #completed = new WeakSet();
  constructor(loader, maxRows) {
    this.#loader = loader;
    this.#maxRows = maxRows;
  }
  check(type, signal) {
    const module = type.module;
    if (!module || type.metadataToken >>> 24 !== 2) {
      throw unsupported('Base virtual methods require metadata; intrinsic slots are not available');
    }
    if (this.#completed.has(type)) return null;
    const rows = this.#index(module).get(type.metadataToken & 0xffffff);
    if (!rows) return null;
    return this.#classify(type, rows, signal);
  }
  #index(module) {
    if (this.#modules.has(module)) return this.#modules.get(module);
    const count = module.rowCount(25);
    if (count > this.#maxRows) throw loadError(LoadErrorCode.LimitExceeded, 'MethodImpl row limit exceeded');
    const owners = new Map();
    const typeCount = module.rowCount(2);
    for (let rid = 1; rid <= count; rid++) {
      const row = module.row(0x19000000 + rid);
      if (!Number.isInteger(row[0]) || row[0] < 1 || row[0] > typeCount) throw invalid('Invalid MethodImpl owner');
      if (!owners.has(row[0])) owners.set(row[0], []);
      owners.get(row[0]).push(row);
    }
    this.#modules.set(module, owners);
    return owners;
  }
  #token(module, kind, coded) {
    const bits = kind === 'MethodDefOrRef' ? 1 : 3;
    if (!Number.isInteger(coded) || coded < 1 || coded >= 0x1000000 * 2 ** bits) {
      throw invalid(`Invalid MethodImpl ${kind} encoding`);
    }
    let token;
    try { token = decodeCoded(kind, coded); }
    catch { throw invalid(`Invalid MethodImpl ${kind} token`); }
    const rid = token & 0xffffff;
    if (!rid || rid > module.rowCount(token >>> 24)) throw invalid(`Invalid MethodImpl ${kind} extent`);
    return token;
  }
  async #classify(type, rows, signal) {
    const module = type.module;
    // MethodDef construction indexes ownership lists; preflight before that allocation.
    if (module.rowCount(2) + module.rowCount(5) + module.rowCount(6) > this.#maxRows) {
      throw loadError(LoadErrorCode.LimitExceeded, 'MethodImpl ownership row limit exceeded');
    }
    const declarations = new Set();
    let signatureBytes = 0;
    for (const [, body, declaration] of rows) {
      checkCancellation(signal);
      const bodyToken = this.#token(module, 'MethodDefOrRef', body);
      const declarationToken = this.#token(module, 'MethodDefOrRef', declaration);
      if (bodyToken >>> 24 !== 6) throw unsupported('MemberRef MethodImpl bodies require an explicit method resolver');
      if (module.methodDefinition(bodyToken).declaringType !== type) throw invalid('MethodImpl body belongs to another type');
      if (declarations.has(declarationToken)) throw invalid('Duplicate MethodImpl declaration');
      declarations.add(declarationToken);
      let contract;
      if (declarationToken >>> 24 === 6) {
        contract = module.methodDefinition(declarationToken).declaringType;
      } else {
        const [parent, , blob] = module.row(declarationToken);
        const parentToken = this.#token(module, 'MemberRefParent', parent);
        if (![1, 2].includes(parentToken >>> 24)) {
          throw unsupported('MethodImpl declaration requires a TypeDef or TypeRef interface parent');
        }
        try {
          const bytes = module.blob(blob, { maxBytes: 4096 });
          if ((signatureBytes += bytes.length) > 128 * 1024) {
            throw loadError(LoadErrorCode.LimitExceeded, 'MethodImpl declaration signature budget exceeded');
          }
          if (decodeSignature(bytes, { maxDepth: 32, maxNodes: 4096 }).kind !== 'method') {
            throw invalid('MethodImpl declaration must reference a method');
          }
        } catch (error) {
          if (error.code?.startsWith('SFCLR')) throw error;
          throw invalid(`Invalid MethodImpl declaration signature: ${error.message}`);
        }
        contract = await this.#loader.load(module, parentToken, { signal });
      }
      if (!contract.isInterface) throw unsupported('Class MethodImpl and covariant mappings require an explicit slot service');
    }
    checkCancellation(signal);
    this.#completed.add(type);
  }
}
