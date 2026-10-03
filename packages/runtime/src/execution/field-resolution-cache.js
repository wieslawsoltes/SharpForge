import {cachedField} from './token-cache.js';

/** Preserve the field-resolution seam while sharing the VM's code-epoch cache. */
export class FieldResolutionCache {
  constructor(typeSystem) {
    this.typeSystem = typeSystem;
  }

  resolve(token, receiverTable = null) {
    return cachedField(this.typeSystem.vm, token, receiverTable);
  }
}
