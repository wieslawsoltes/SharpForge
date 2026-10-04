/**
 * Bodies of the members a record synthesizes (SF-A02-T08.6): the primary constructor of a positional record,
 * `Equals(R)`, `==` / `!=`, `GetHashCode`, `ToString`, `Deconstruct` and the copy `with` makes.
 *
 * A record class is an ordinary image class. Nothing derives from it (inheritance is not generated), so its members
 * are bound statically and each body is built the first time code refers to the member: a record whose `ToString`
 * would need virtual dispatch for one of its members still runs as long as nothing asks for its text.
 * Member-wise equality and text go through lowering/tuples/structural-members.js, for which this class is the
 * provider of record types.
 */
import { SymbolKind, TypeKind } from '../../symbols/types.js';
import { RecordMember, positionalProperties } from '../../symbols/synthesized/records.js';
import { n } from '../../codegen/semantic/node-factory.js';
import { RecordContractBody } from '../../symbols/synthesized/record-contract-members.js';

/** `PrintMembers` and `get_EqualityContract`: emitted only by the .NET assembly back end. */
const contractKinds = new Set(Object.values(RecordContractBody));

/** The multiplier Roslyn's synthesized GetHashCode combines members with. */
const hashFactor = -1521134295;
const isInstance = member => !member.isStatic && !member.isConst;

export class RecordMembers {
  /**
   * @param host the generator: `{program, types, structural, fields, autoProperties, instanceInits, isSource(symbol),
   *   classOf(type, syntax), methodOf(symbol, syntax), cellClass(type), addSynthesizedBody(method, body), unsupported(...)}`
   */
  constructor(host) {
    this.host = host;
    this.methods = new Map();
    this.clones = new Map();
  }
  /** True for a record class of the program. */
  handles(type) {
    return !!type?.isRecord && type.typeKind === TypeKind.Class && this.host.isSource(type);
  }
  /** A virtual member or an override in a record is called through the record's static type: nothing derives from it. */
  dispatchesStatically(method) {
    return (method.isOverride || method.isVirtual) && !method.isAbstract && this.handles(method.containingType);
  }
  /** The stored members of a record, in declaration order: `{name, type, record, property}` per instance field. */
  storage(type) {
    const slots = [],
      seen = new Set();
    const add = (name, memberType, record, property) => {
      if (!record || seen.has(record)) return;
      seen.add(record);
      slots.push({ name, type: memberType, record, property });
    };
    for (const member of type.getMembers()) {
      if (!isInstance(member)) continue;
      if (member.kind === SymbolKind.Field) add(member.name, member.type, this.host.fields.get(member), member.associatedSymbol ?? null);
      else if (member.kind === SymbolKind.Property && member.isAutoProperty) add(member.name, member.type, this.host.autoProperties.get(member), member);
    }
    return slots;
  }
  /** The members `ToString` prints: public instance fields and readable public properties, in declaration order. */
  printable(type) {
    return type.getMembers().filter(member => {
      if (!isInstance(member) || member.declaredAccessibility !== 'public') return false;
      if (member.kind === SymbolKind.Field) return !member.associatedSymbol;
      return member.kind === SymbolKind.Property && !member.parameters?.length && !!member.getMethod;
    });
  }
  /** The image method of a synthesized record member (declared and built on first use), or null for any other symbol. */
  methodOf(symbol, syntax = null) {
    const kind = symbol.recordMember;
    if (!kind) return null;
    let method = this.methods.get(symbol);
    if (method) return method;
    if (kind === RecordMember.EqualsObject) return this.host.unsupported('Equals(object) on a record (needs a run-time type test)', syntax);
    if (contractKinds.has(kind)) return this.host.unsupported(`the synthesized record member '${symbol.name}'`, syntax);
    const type = symbol.containingType,
      owner = this.host.classOf(type, syntax),
      parameters = this.host.parametersOf(symbol);
    method = this.host.program.addMethod(owner, kind, {
      isStatic: symbol.isStatic,
      returnType: this.host.types.imageType(symbol.returnType, syntax),
      parameters,
    });
    this.methods.set(symbol, method);
    const self = () => n.thisReference(owner.name),
      argument = index => n.parameter(n.newParameter(parameters[index].name, parameters[index].type, index));
    this.host.addSynthesizedBody(method, n.block(this.body(kind, { type, owner, self, argument, parameters, syntax })));
    return method;
  }
  body(kind, context) {
    switch (kind) {
      case RecordMember.Equals:
        return this.equalsBody(context);
      case RecordMember.Equality:
      case RecordMember.Inequality:
        return this.operatorBody(kind, context);
      case RecordMember.ToString:
        return this.toStringBody(context);
      case RecordMember.GetHashCode:
        return this.hashBody(context);
      default:
        return this.deconstructBody(context);
    }
  }
  member(type, name, matches) {
    return type.getMembers(name).find(candidate => candidate.kind === SymbolKind.Method && matches(candidate.parameters));
  }
  /** `Equals(R other)`: the other record exists and every stored member is equal. */
  equalsBody({ type, self, argument, syntax }) {
    let result = n.notEquals(argument(0), n.nullLiteral(argument(0).legacyType));
    for (const slot of this.storage(type)) {
      const equal = this.host.structural.equals(
        slot.type,
        () => n.field(self(), slot.record),
        () => n.field(argument(0), slot.record),
        'equals',
        syntax,
      );
      result = n.logicalAnd(result, equal);
    }
    return [n.returnStatement(result)];
  }
  /** `left == right`: the same object, or `left.Equals(right)` when left is not null. */
  operatorBody(kind, { type, argument, syntax }) {
    const equals = this.host.methodOf(
      this.member(type, 'Equals', parameters => parameters.length === 1 && parameters[0].type === type),
      syntax,
    );
    const isNull = n.equals(argument(0), n.nullLiteral(argument(0).legacyType)),
      memberwise = n.conditional(isNull, n.literal(false, 'bool'), n.call(equals, argument(0), [argument(1)]), 'bool'),
      equal = n.logicalOr(n.equals(argument(0), argument(1)), memberwise);
    return [n.returnStatement(kind === RecordMember.Equality ? equal : n.not(equal))];
  }
  /** `Name { A = 1, B = x }`, the text Roslyn's ToString and PrintMembers produce. */
  toStringBody({ type, self, syntax }) {
    const members = this.printable(type);
    if (!members.length) return [n.returnStatement(n.literal(type.name + ' { }', 'string'))];
    let text = n.literal(type.name + ' { ', 'string');
    members.forEach((member, index) => {
      const label = (index ? ', ' : '') + member.name + ' = ',
        value = this.host.structural.toString(member.type, () => this.read(member, self, syntax), syntax);
      text = n.binary('+', n.binary('+', text, n.literal(label, 'string'), 'string'), value, 'string');
    });
    return [n.returnStatement(n.binary('+', text, n.literal(' }', 'string'), 'string'))];
  }
  /** Reads a field or property of a record object. */
  read(member, receiver, syntax) {
    if (member.kind === SymbolKind.Field) return n.field(receiver(), this.host.fields.get(member));
    const backing = member.isAutoProperty ? this.host.autoProperties.get(member) : null;
    return backing ? n.field(receiver(), backing) : n.call(this.host.methodOf(member.getMethod, syntax), receiver(), []);
  }
  /** Equal records have equal hash codes; the value itself differs from .NET's (which mixes in the type's identity). */
  hashBody({ type, self, syntax }) {
    let hash = n.literal(0, 'int');
    for (const slot of this.storage(type)) {
      const part = this.hashOf(slot.type, () => n.field(self(), slot.record), syntax);
      hash = n.binary('+', n.binary('*', hash, n.literal(hashFactor, 'int'), 'int'), part, 'int');
    }
    return [n.returnStatement(hash)];
  }
  hashOf(type, value, syntax) {
    const imageType = this.host.types.imageType(type, syntax);
    if (imageType === 'int') return value();
    if (imageType === 'bool') return n.conditional(value(), n.literal(1, 'int'), n.literal(0, 'int'), 'int');
    if (this.handles(type)) {
      const method = this.host.methodOf(this.member(type, 'GetHashCode', parameters => !parameters.length), syntax);
      return n.conditional(n.equals(value(), n.nullLiteral(imageType)), n.literal(0, 'int'), n.call(method, value(), []), 'int');
    }
    return this.host.unsupported(`the hash code of a member of type '${type.toDisplayString()}'`, syntax);
  }
  /** `Deconstruct(out p1, ..)`: each by-reference parameter is a cell that receives one positional property. */
  deconstructBody({ type, self, argument, syntax }) {
    return positionalProperties(type).map((property, index) => {
      const cell = this.host.cellClass(this.host.types.imageType(property.type, syntax));
      return n.expressionStatement(n.assign(n.field(argument(index), cell.value), this.read(property, self, syntax)));
    });
  }
  // ---- construction and copying ----
  /**
   * The body of the primary constructor of a positional record: the parameters initialize the positional
   * properties, then the other initializers run. Returns false for any other method.
   */
  buildConstructor(symbol, method) {
    const type = symbol.containingType;
    if (!symbol.isPrimaryConstructor || !this.handles(type)) return false;
    if (symbol.baseArgumentsSyntax) return this.host.unsupported('base constructor calls', symbol.locations?.[0]);
    const self = () => n.thisReference(method.owner.name),
      statements = [];
    symbol.parameters.forEach((parameter, index) => {
      const property = type.getMembers(parameter.name).find(member => member.kind === SymbolKind.Property && member.isPositional),
        backing = property && this.host.autoProperties.get(property);
      if (!backing) return;
      const value = n.parameter(n.newParameter(parameter.name, method.parameters[index].type, index));
      statements.push(n.expressionStatement(n.assign(n.field(self(), backing), value)));
    });
    const initializer = this.host.instanceInits.get(type);
    // The instance initializer of a type with a primary constructor takes its parameters (they are in scope there).
    const forwarded = method.parameters.map((parameter, index) => n.parameter(n.newParameter(parameter.name, parameter.type, index)));
    if (initializer) statements.push(n.expressionStatement(n.call(initializer, self(), forwarded)));
    this.host.addSynthesizedBody(method, n.block(statements));
    return true;
  }
  /** A copy of a record object: what the synthesized copy constructor produces. */
  clone(type, value, syntax) {
    const owner = this.host.classOf(type, syntax);
    let method = this.clones.get(owner);
    if (!method) {
      const declared = type.getMembers('.ctor').find(ctor => ctor.parameters.length === 1 && ctor.parameters[0].type === type && !ctor.isImplicitlyDeclared);
      if (declared) return this.host.unsupported('a record with its own copy constructor', syntax);
      method = this.host.program.addMethod(owner, '<Clone>$', { isStatic: true, returnType: owner.name, parameters: [{ name: 'original', type: owner.name }] });
      this.clones.set(owner, method);
      const original = () => n.parameter(n.newParameter('original', owner.name, 0)),
        copy = n.newLocal('copy', owner.name),
        copies = owner.fields.map(field => n.expressionStatement(n.assign(n.field(n.local(copy), field), n.field(original(), field))));
      // The first field read faults for a null receiver, as `with` on null does on .NET.
      this.host.addSynthesizedBody(method, n.block([n.declare([[copy, n.allocate(owner)]]), ...copies, n.returnStatement(n.local(copy))], [copy]));
    }
    return n.call(method, null, [value]);
  }
  // ---- structural members (lowering/tuples/structural-members.js) ----
  equals(type, left, right, mode, syntax) {
    const operator = this.member(type, RecordMember.Equality, parameters => parameters.length === 2);
    return n.call(this.host.methodOf(operator, syntax), null, [left(), right()]);
  }
  toString(type, value, syntax) {
    const method = this.host.methodOf(this.member(type, 'ToString', parameters => !parameters.length), syntax),
      imageType = this.host.types.imageType(type, syntax);
    return n.conditional(n.equals(value(), n.nullLiteral(imageType)), n.literal('', 'string'), n.call(method, value(), []), 'string');
  }
}
