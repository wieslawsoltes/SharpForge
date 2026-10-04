/**
 * Tuples as image classes (SF-A02-T08.4).
 *
 * The runtime has no value types, so `System.ValueTuple<T1..Tn>` cannot run as a struct. Each tuple shape becomes one
 * synthesized image class with the fields `Item1..ItemN`, and value semantics are kept by never changing a tuple
 * object after it was created: a store into an element builds a new object (lowering/tuples/locations.js), so a tuple
 * that was copied - assigned, passed, returned, captured - can share its object safely.
 *
 * A tuple of more than seven elements is one class too, with the fields `Item1..ItemN`: the nesting in `Rest` is a
 * property of the ValueTuple type, not of the value. Reading `Rest` builds the tuple of the elements from the eighth
 * on (translate-tuples.js), which is a copy - as it is for the struct.
 *
 * Element names exist only at compile time, so `(int a, int b)` and `(int, int)` are one class. The members a tuple
 * needs at run time (creation, `==`, `Equals`, `ToString`) are static methods of that class, declared on first use.
 */
import { n } from '../../codegen/semantic/node-factory.js';
import { tupleElements } from '../../symbols/tuple-elements.js';

export class TupleClasses {
  /**
   * @param host the generator: `{program, types, structural, addSynthesizedBody(method, body), unsupported(construct, syntax)}`
   */
  constructor(host) {
    this.host = host;
    this.byKey = new Map();
    this.byName = new Map();
  }
  /** True for a tuple type the lowering handles: a construction of ValueTuple, not the open definition. */
  handles(type) {
    return !!type?.isTupleType && !type.isDefinition;
  }
  /** The image class of a tuple type: `{record, fields, elementTypes, create, methods}`. */
  classOf(type, syntax = null) {
    const elementTypes = tupleElements(type).map(argument => argument.type),
      imageTypes = elementTypes.map(element => this.host.types.imageType(element, syntax)),
      // No comma in the name: the runtime reads commas in a type name as generic argument separators.
      key = imageTypes.join(';');
    let info = this.byKey.get(key);
    if (info) return info;
    const program = this.host.program,
      // No comma in the name: the runtime reads `IList<element>` of an array's element type by splitting at commas.
      record = program.addClass(`ValueTuple(${imageTypes.join(';')})`);
    info = { record, imageTypes, elementTypes, fields: [], create: null, methods: new Map() };
    info.fields = imageTypes.map((imageType, index) => program.addField(record, 'Item' + (index + 1), imageType));
    this.byKey.set(key, info);
    this.byName.set(record.name, info);
    return info;
  }
  /** The tuple class with this image type name, or null. */
  infoOf(imageType) {
    return this.byName.get(imageType) ?? null;
  }
  /** A new tuple object holding `values` (lowered expressions, in element order). */
  create(info, values) {
    return n.call(this.factory(info), null, values);
  }
  /** `default` of the tuple type: every element has its default value. */
  defaultInstance(info, defaultValue) {
    return this.create(
      info,
      info.imageTypes.map(imageType => defaultValue(imageType)),
    );
  }
  /** A copy of `tuple` (a re-readable lowered expression) in which element `index` is `value`. */
  withElement(info, tuple, index, value) {
    return this.create(
      info,
      info.fields.map((field, i) => (i === index ? value : n.field(tuple(), field))),
    );
  }
  factory(info) {
    if (info.create) return info.create;
    const type = info.record.name,
      parameters = info.imageTypes.map((imageType, index) => ({ name: 'item' + (index + 1), type: imageType }));
    info.create = this.host.program.addMethod(info.record, '<Create>', { isStatic: true, returnType: type, parameters });
    const tuple = n.newLocal('tuple', type),
      stores = info.fields.map((field, index) =>
        n.expressionStatement(n.assign(n.field(n.local(tuple), field), n.parameter(n.newParameter(parameters[index].name, field.type, index)))),
      );
    const body = n.block([n.declare([[tuple, n.allocate(info.record)]]), ...stores, n.returnStatement(n.local(tuple))], [tuple]);
    this.host.addSynthesizedBody(info.create, body);
    return info.create;
  }
  /** A static method of the tuple class, declared and built on first use. `build(a, b)` returns its statements. */
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
  /** Element-wise equality: `mode` is 'operator' (the `==` of each element) or 'equals' (its `Equals`). */
  equals(type, left, right, mode, syntax) {
    const info = this.classOf(type, syntax);
    const method = this.method(info, mode === 'operator' ? 'op_Equality' : 'Equals', 'bool', 2, (a, b) => {
      let result = null;
      info.fields.forEach((field, index) => {
        const element = this.host.structural.equals(
          info.elementTypes[index],
          () => n.field(a(), field),
          () => n.field(b(), field),
          mode,
          syntax,
        );
        result = result ? n.logicalAnd(result, element) : element;
      });
      return [n.returnStatement(result)];
    });
    return n.call(method, null, [left(), right()]);
  }
  /** `(Item1, Item2)`: the text ValueTuple.ToString produces. */
  toString(type, value, syntax) {
    const info = this.classOf(type, syntax);
    const method = this.method(info, 'ToString', 'string', 1, a => {
      let text = n.literal('(', 'string');
      info.fields.forEach((field, index) => {
        if (index) text = n.binary('+', text, n.literal(', ', 'string'), 'string');
        const element = this.host.structural.toString(info.elementTypes[index], () => n.field(a(), field), syntax);
        text = n.binary('+', text, element, 'string');
      });
      return [n.returnStatement(n.binary('+', text, n.literal(')', 'string'), 'string'))];
    });
    return n.call(method, null, [value()]);
  }
}
