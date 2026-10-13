import { TypeKind } from '../type-system/type-desc.js';
import { loadError, LoadErrorCode } from '../load-errors.js';

const fail = () => loadError(LoadErrorCode.TypeLoad, 'Signature class/value category does not match its definition');
const empty = Object.freeze([]);

function requireCategory(category, encoding) {
  if ((encoding === 'valuetype') !== [TypeKind.ValueType, TypeKind.Enum].includes(category)) throw fail();
}

/** Root-owned encoded occurrences are qualified by the same immutable direct records as graph completion. */
export class SignatureCategories {
  #work;
  #pending = new Map();

  constructor(work) { this.#work = work; }

  add(type, encoding) {
    const definition = type.genericDefinition ?? type;
    this.#work.observe(definition);
    if (definition.isLoaded || definition.isInterface) {
      requireCategory(definition.kind, encoding);
      return;
    }
    const previous = this.#pending.get(definition);
    if (previous && previous !== encoding) throw fail();
    this.#pending.set(definition, encoding);
  }

  pending() { return this.#pending.size ? this.#pending.keys() : empty; }

  validate(requireAll = false) {
    for (const [definition, encoding] of this.#pending) {
      this.#work.visit();
      const binding = this.#work.template(definition);
      let category = definition.kind;
      if (!definition.isLoaded && !definition.isInterface) {
        if (!binding) {
          if (requireAll) throw loadError(LoadErrorCode.TypeLoad, 'Signature category has no completed canonical binding');
          continue;
        }
        const owner = definition.loadContext.types;
        category = owner.isIntrinsic(binding.baseType, 'System.ValueType') ? TypeKind.ValueType
          : owner.isIntrinsic(binding.baseType, 'System.Enum') ? TypeKind.Enum : TypeKind.Class;
      }
      requireCategory(category, encoding);
      // Publication verifies this same direct record. A conflicting concurrent publication invalidates the root.
      this.#pending.delete(definition);
    }
  }

  dispose() { this.#pending.clear(); }
}
