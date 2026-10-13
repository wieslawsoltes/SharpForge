import { cliSystemName, decodeCoded, decodeSignature } from '@sharpforge/cil';
import { TypeDesc, TypeKind } from './type-desc.js';
import { definitionBindings } from '../generics/definition-bindings.js';
import { loadError, LoadErrorCode } from '../load-errors.js';

const fail = message => loadError(LoadErrorCode.TypeLoad, message);
const enumPrimitives = new Set(['sbyte', 'byte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong']);
const empty = Object.freeze([]);

/** Complete a metadata definition using the exact direct bindings already consumed by its finite-closure proof. */
export class TypeDefinitionCompletion {
  #services;

  constructor(services) { this.#services = Object.freeze(services); }

  async complete(type, operation) {
    const module = type.module;
    const token = type.metadataToken;
    const row = module.row(token);
    const nested = { ...operation, path: new Set([...operation.path, type]), scope: this.#services.scope(type),
      identityOnly: false, rootResult: false };
    const template = operation.root.generic?.template(type);
    const baseType = template ? (template.baseType ? await this.#services.complete(template.baseType, nested) : null)
      : row[3] ? await this.#services.load(module, decodeCoded('TypeDefOrRef', row[3]), nested) : null;
    if (baseType?.isInterface || (type.isInterface && baseType)) throw fail('Invalid class/interface base relationship');
    if (baseType && [TypeKind.Array, TypeKind.SZArray, TypeKind.Pointer, TypeKind.ByRef, TypeKind.FunctionPointer].includes(baseType.kind)) {
      throw fail('Invalid constructed base type');
    }
    if (baseType && ((baseType.flags & 0x100) || [TypeKind.ValueType, TypeKind.Enum].includes((baseType.genericDefinition ?? baseType).kind))) {
      throw fail('A type cannot derive from a sealed or value type');
    }
    const references = template?.interfaces ?? this.#services.interfaces(module, token) ?? empty;
    const direct = template?.interfaces ?? (references.length ? [] : empty);
    const interfaces = new Set(baseType?.interfaces ?? []);
    for (const reference of references) {
      const contract = reference instanceof TypeDesc ? await this.#services.complete(reference, nested)
        : await this.#services.load(module, reference, nested);
      if (!contract.isInterface) throw fail('InterfaceImpl does not name an interface');
      if (!template) direct.push(contract);
      interfaces.add(contract);
      for (const inherited of contract.interfaces) interfaces.add(inherited);
    }
    const kind = type.isInterface ? TypeKind.Interface : baseType === this.#services.intrinsic('System.Enum') ? TypeKind.Enum
      : baseType === this.#services.intrinsic('System.ValueType') ? TypeKind.ValueType : TypeKind.Class;
    const underlyingType = kind === TypeKind.Enum ? this.#enumUnderlying(module, token) : null;
    if (kind === TypeKind.Enum && nested.scope) throw fail('Enums cannot declare generic type parameters');
    this.#services.publish(type, { kind, baseType, interfaces: Object.freeze([...interfaces]), underlyingType, loaded: true },
      operation, template ?? definitionBindings(baseType, direct));
    return type;
  }

  #enumUnderlying(module, token) {
    const fields = module.list(token, 'FieldList').filter(field => !(module.row(field)[0] & 0x10));
    if (fields.length !== 1) throw fail('Enum must have one instance field');
    const signature = decodeSignature(module.blob(module.row(fields[0])[2]));
    if (signature.kind !== 'field' || signature.type.kind !== 'primitive' || !enumPrimitives.has(signature.type.name)) {
      throw fail('Enum instance field must have an integral type');
    }
    return this.#services.requireIntrinsic(cliSystemName(signature.type.name));
  }
}
