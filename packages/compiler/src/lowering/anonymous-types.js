/**
 * Anonymous types as image classes (SF-A02-T53).
 *
 * Each anonymous type becomes one image class with a field per property; a property read is a field read, since
 * the properties are read-only and have no code of their own. `Equals` and `ToString` are static methods of that
 * class, built on first use from the static types of the members (lowering/tuples/structural-members.js), because
 * the runtime has no virtual dispatch:
 *
 *   a.ToString(), "" + a, $"{a}", Console.WriteLine(a)     "{ Name = x, Age = 3 }"   ("{ }" without members)
 *   a.Equals(b)   with b of the same anonymous type        member-wise, false for a null b
 *   a == b                                                 reference equality, as on .NET
 *
 * What needs the run-time type is reported as not executable: `GetHashCode`, `Equals` with an argument of another
 * static type, and converting the object to `object` or an interface.
 */
import { n } from '../codegen/semantic/node-factory.js';

/** Structural-member provider and class table for anonymous types. */
export class AnonymousClasses {
  /** @param host the generator: `{program, types, structural, addSynthesizedBody(method, body), unsupported(construct, syntax)}` */
  constructor(host) {
    this.host = host;
    this.bySymbol = new Map();
  }
  handles(type) {
    return !!type?.isAnonymousType;
  }
  /** The image class of an anonymous type: `{record, members, fields, methods}`. */
  classOf(type, syntax = null) {
    let info = this.bySymbol.get(type);
    if (info) return info;
    // Not the metadata name `<>f__AnonymousTypeN`: the runtime reads angle brackets in a type name as type arguments.
    const program = this.host.program,
      record = program.addClass(`AnonymousType(${this.bySymbol.size})`);
    info = { record, members: type.anonymousMembers, fields: [], methods: new Map() };
    this.bySymbol.set(type, info);
    info.fields = info.members.map(member => program.addField(record, member.name, this.host.types.imageType(member.type, syntax)));
    return info;
  }
  /** A static method of the class, declared and built on first use; `build(a, b)` returns its statements. */
  method(info, name, returnType, arity, build) {
    let method = info.methods.get(name);
    if (method) return method;
    const type = info.record.name,
      parameters = [{ name: 'a', type }, { name: 'b', type }].slice(0, arity);
    method = this.host.program.addMethod(info.record, name, { isStatic: true, returnType, parameters });
    info.methods.set(name, method);
    const operands = parameters.map((parameter, index) => () => n.parameter(n.newParameter(parameter.name, type, index)));
    this.host.addSynthesizedBody(method, n.block(build(...operands)));
    return method;
  }
  // ---- structural members (lowering/tuples/structural-members.js) ----
  /** `==` is reference equality; `Equals` compares member by member and is false for a null argument. */
  equals(type, left, right, mode, syntax) {
    if (mode === 'operator') return n.equals(left(), right());
    const info = this.classOf(type, syntax);
    const method = this.method(info, 'Equals', 'bool', 2, (a, b) => {
      let result = n.notEquals(b(), n.nullLiteral(info.record.name));
      info.fields.forEach((field, index) => {
        const read = operand => () => n.field(operand(), field);
        result = n.logicalAnd(result, this.host.structural.equals(info.members[index].type, read(a), read(b), 'equals', syntax));
      });
      return [n.returnStatement(result)];
    });
    return n.call(method, null, [left(), right()]);
  }
  /** `{ Name = x, Age = 3 }`: the text an anonymous type's ToString produces. */
  toString(type, value, syntax) {
    const info = this.classOf(type, syntax);
    const method = this.method(info, 'ToString', 'string', 1, a => {
      let text = n.literal('{ ', 'string');
      info.fields.forEach((field, index) => {
        const label = (index ? ', ' : '') + info.members[index].name + ' = ',
          member = this.host.structural.toString(info.members[index].type, () => n.field(a(), field), syntax);
        text = n.binary('+', n.binary('+', text, n.literal(label, 'string'), 'string'), member, 'string');
      });
      return [n.returnStatement(n.binary('+', text, n.literal(info.fields.length ? ' }' : '}', 'string'), 'string'))];
    });
    return n.call(method, null, [value()]);
  }
}

/** The argument of `a.Equals(b)` without the conversion to `object` the call applies. */
const unboxed = node => (node.kind === 'Conversion' && node.type?.specialType === 'System_Object' ? node.operand : node);

/** Translator mixin: creation, property reads and the `object` members of anonymous types. */
export const AnonymousTypeLowering = Base =>
  class extends Base {
    exprAnonymousObjectCreation(node) {
      // The values are stored in member order, which is the order they are written in.
      const info = this.g.anonymous.classOf(node.type, node.syntax),
        instance = this.temp(info.record.name, 'anonymous'),
        stores = node.initializers.map((initializer, index) =>
          n.assign(n.field(n.local(instance), info.fields[index]), this.expression(initializer.value)),
        );
      return n.sequence([instance], [n.assign(n.local(instance), n.allocate(info.record)), ...stores], n.local(instance));
    }
    /**
     * `a with { X = v }` (C# 10): a new instance whose members are the listed values and, for the others, the
     * members of `a`. The receiver and then the values are evaluated once, in the order they are written.
     */
    exprWith(node) {
      if (!this.g.anonymous.handles(node.type)) return super.exprWith(node);
      const info = this.g.anonymous.classOf(node.type, node.syntax),
        source = this.temp(info.record.name, 'with'),
        instance = this.temp(info.record.name, 'anonymous'),
        locals = [source, instance],
        effects = [n.assign(n.local(source), this.expression(node.receiver))],
        replaced = new Map();
      for (const entry of node.initializers) {
        const index = info.members.findIndex(member => member.name === entry.target?.property?.name);
        if (index < 0 || !entry.value || entry.value.kind === 'ObjectInitializer') return this.unsupported('this with expression', node.syntax);
        const value = this.temp(info.fields[index].type, 'value');
        locals.push(value);
        effects.push(n.assign(n.local(value), this.expression(entry.value)));
        replaced.set(index, value);
      }
      effects.push(n.assign(n.local(instance), n.allocate(info.record)));
      info.fields.forEach((field, index) => {
        const value = replaced.has(index) ? n.local(replaced.get(index)) : n.field(n.local(source), field);
        effects.push(n.assign(n.field(n.local(instance), field), value));
      });
      return n.sequence(locals, effects, n.local(instance));
    }
    exprPropertyAccess(node) {
      const owner = node.property.containingType ?? node.property.containingSymbol;
      if (!this.g.anonymous.handles(owner)) return super.exprPropertyAccess(node);
      const info = this.g.anonymous.classOf(owner, node.syntax),
        index = info.members.findIndex(member => member.name === node.property.name);
      return n.field(this.expression(node.receiver), info.fields[index]);
    }
    exprCall(node) {
      const receiver = node.receiver,
        method = node.method;
      if (!receiver || !this.g.anonymous.handles(receiver.type) || this.g.isSource(method)) return super.exprCall(node);
      if (method.name === 'Equals' && node.args?.length === 1) return this.anonymousEquals(node);
      if (method.name === 'GetHashCode') return this.unsupported('GetHashCode of an anonymous type (needs virtual dispatch)', node.syntax);
      return super.exprCall(node);
    }
    /** `a == b` on anonymous types is reference equality: the conversions to `object` change nothing. */
    exprBinary(node) {
      if ((node.operator !== '==' && node.operator !== '!=') || node.method) return super.exprBinary(node);
      const identity = operand => {
        const inner = unboxed(operand);
        return inner !== operand && this.g.anonymous.handles(inner.type) ? inner : operand;
      };
      return super.exprBinary({ ...node, left: identity(node.left), right: identity(node.right) });
    }
    anonymousEquals(node) {
      const type = node.receiver.type,
        argument = unboxed(node.args[0].expression);
      if (argument.literal === 'null' || argument.constantValue?.isNull) {
        // The receiver is still evaluated; nothing equals null.
        return n.sequence([], [this.expression(node.receiver)], n.literal(false, 'bool'));
      }
      if (!argument.type?.equals(type)) return this.unsupported('Equals of an anonymous type with a value of another static type', node.syntax);
      const left = this.once(this.expression(node.receiver), 'left'),
        right = this.once(this.expression(argument), 'right');
      return n.sequence(
        [...left.locals, ...right.locals],
        [...left.effects, ...right.effects],
        this.g.structural.equals(type, left.read, right.read, 'equals', node.syntax),
      );
    }
  };
