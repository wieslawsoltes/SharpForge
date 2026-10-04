/** Preallocated metadata and RVA data for UTF-8 literals; method emission never adds or moves their field tokens. */
import { CilError, FieldAttributes, TypeAttributes, TEXT_RVA, sha256 } from '@sharpforge/cil';
import { Accessibility, NamedTypeSymbol, TypeKind } from '../../symbols/types.js';
import { privateImplementationDetailsTypeName } from '../../lowering/generated-names.js';
import { lowerUtf8Literals } from '../../lowering/utf8-strings.js';
import { utf8SpanConstructors } from './utf8-runtime.js';

const DATA_FLAGS = FieldAttributes.Assembly | FieldAttributes.Static | FieldAttributes.InitOnly | FieldAttributes.HasFieldRVA;
const BLOB_FLAGS = TypeAttributes.NestedAssembly | TypeAttributes.ExplicitLayout | TypeAttributes.Sealed;
const emptyPlan = () => ({ fields: [], methods: [], properties: [], events: [] });
const digestName = bytes => Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();

/** One assembly's body-only literal storage. Reference assembly emission does not instantiate this plan. */
export class Utf8DataPlan {
  constructor(analysis) {
    const lowered = lowerUtf8Literals(analysis);
    this.literals = lowered.literals;
    this.types = [];
    this.plans = new Map();
    this.data = [];
    this.constructors = null;
    this.owner = null;
    if (!this.literals.size) return;
    this.constructors = utf8SpanConstructors(analysis.core, lowered.locations);
    if (!this.constructors.pointer) return;
    const core = analysis.core;
    this.owner = new NamedTypeSymbol({
      name: privateImplementationDetailsTypeName(),
      containingSymbol: analysis.assembly.globalNamespace,
      declaredAccessibility: Accessibility.Internal,
      isSealed: true,
      isImplicitlyDeclared: true,
      baseType: core.object,
    });
    this.owner.isSource = true;
    this.types.push(this.owner);
    const plan = emptyPlan();
    this.plans.set(this.owner, plan);
    const sizes = new Map([[1, core.byte], [2, core.short], [4, core.int], [8, core.long]]);
    for (const literal of this.literals.values()) {
      let type = sizes.get(literal.bytes.length);
      if (!type) {
        type = this.blobType(literal.bytes.length, core);
        sizes.set(literal.bytes.length, type);
      }
      const field = { symbol: null, name: digestName(literal.bytes), flags: DATA_FLAGS, type, constant: null };
      plan.fields.push(field);
      this.data.push({ field, literal });
      literal.field = field;
    }
  }
  blobType(size, core) {
    const type = new NamedTypeSymbol({
      name: `__StaticArrayInitTypeSize=${size}`,
      containingSymbol: this.owner,
      declaredAccessibility: Accessibility.Internal,
      typeKind: TypeKind.Struct,
      baseType: core.valueType,
      isImplicitlyDeclared: true,
    });
    type.isSource = true;
    this.types.push(type);
    this.plans.set(type, { ...emptyPlan(), typeFlags: BLOB_FLAGS, classSize: size, classPackingSize: 1 });
    return type;
  }
  /** Adds preplanned fields and layout to the ordinary metadata member plan. */
  extend(type, plan) {
    const additions = this.plans.get(type);
    if (additions) Object.assign(plan, additions);
  }
  /** A literal must already have been collected before definition tokens were assigned. */
  literal(text) {
    const literal = this.literals.get(text);
    if (!literal) throw new CilError('UTF-8 literal was not planned before metadata token allocation');
    return literal;
  }
  /** Append bytes after all method bodies and before metadata; FieldRVA references the final planned field tokens. */
  writeRvas(writer, section) {
    if (!this.data.length) return;
    section.pad();
    for (const { field, literal } of this.data) {
      writer.builder.addRow('FieldRVA', { RVA: TEXT_RVA + section.length, Field: field.token });
      section.bytes(literal.bytes);
    }
  }
}
