import { projectParameterDesc } from './parameter-desc.js';
import { loadError, LoadErrorCode } from '../load-errors.js';

const empty = Object.freeze([]);

/** Module-owned Property index-parameter projections; source Param ownership and Constant validation stay in existing services. */
export class MetadataPropertyParameters {
  #module;
  #values = new Map();
  #descriptorCount = 0;
  constructor(module) { this.#module = module; }

  /** Prefer any getter, otherwise omit the setter's final value parameter; no accessor produces an empty array. */
  get(token) {
    if (this.#values.has(token)) return this.#values.get(token);
    try {
      const property = this.#module.propertyDefinition(token);
      const getter = property.getMethod;
      const method = getter ?? property.setMethod;
      const parameters = method?.parameters ?? empty;
      const count = parameters.length - (method && !getter ? 1 : 0);
      if (count < 0) throw loadError(LoadErrorCode.InvalidImage, 'Property setter has no value parameter');
      if (count > 100000 - this.#descriptorCount) {
        throw loadError(LoadErrorCode.LimitExceeded, 'Property parameter descriptor limit exceeded');
      }
      const result = count ? new Array(count) : empty;
      for (let index = 0; index < count; index++) result[index] = projectParameterDesc(parameters[index], property);
      Object.freeze(result);
      this.#values.set(token, result);
      this.#descriptorCount += count;
      return result;
    } catch (error) {
      if (error.code?.startsWith('SFCLR')) throw error;
      throw loadError(LoadErrorCode.InvalidImage, `Invalid property parameter metadata: ${error.message}`);
    }
  }
}
