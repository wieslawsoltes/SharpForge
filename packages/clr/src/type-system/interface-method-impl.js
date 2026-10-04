import { decodeSignature } from '@sharpforge/cil';
import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';
import { MethodImplementationRows, methodImplToken } from './method-impl-rows.js';

const invalid = message => loadError(LoadErrorCode.InvalidImage, message);
const unsupported = message => loadError(LoadErrorCode.TypeLoad, message);

/** Classify interface-only mappings; class MethodImpl slot replacement remains a separate service. */
export class InterfaceMethodImplementations {
  #loader;
  #maxRows;
  #rows;
  #completed = new WeakSet();
  constructor(loader, maxRows) {
    this.#loader = loader;
    this.#maxRows = maxRows;
    this.#rows = new MethodImplementationRows(maxRows);
  }
  check(type, signal) {
    const module = type.module;
    if (!module || type.metadataToken >>> 24 !== 2) {
      throw unsupported('Base virtual methods require metadata; intrinsic slots are not available');
    }
    if (this.#completed.has(type)) return null;
    const rows = this.#rows.forType(type, signal);
    if (!rows.length) return null;
    return this.#classify(type, rows, signal);
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
      const bodyToken = methodImplToken(module, 'MethodDefOrRef', body);
      const declarationToken = methodImplToken(module, 'MethodDefOrRef', declaration);
      if (bodyToken >>> 24 !== 6) throw unsupported('MemberRef MethodImpl bodies require an explicit method resolver');
      if (module.methodDefinition(bodyToken).declaringType !== type) throw invalid('MethodImpl body belongs to another type');
      if (declarations.has(declarationToken)) throw invalid('Duplicate MethodImpl declaration');
      declarations.add(declarationToken);
      let contract;
      if (declarationToken >>> 24 === 6) {
        contract = module.methodDefinition(declarationToken).declaringType;
      } else {
        const [parent, , blob] = module.row(declarationToken);
        const parentToken = methodImplToken(module, 'MemberRefParent', parent);
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
