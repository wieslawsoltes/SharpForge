/**
 * Sub-arrays for slice patterns (`[first, .. var rest]`): on .NET `RuntimeHelpers.GetSubArray` copies the range; here
 * a synthesized static method per element type does, declared the first time a slice of that type is needed.
 */
import { n } from '../../codegen/semantic/node-factory.js';

/**
 * The class that declares the helpers, named like the other synthesized helper classes (`<>Cell(int)`). It is not
 * `<PrivateImplementationDetails>`: the CIL execution profile splits a declared name of the shape `<Name>` into a
 * generic instantiation of an empty definition, and a call into it then faults on the generic arity check (issue #1).
 */
const SLICE_HELPER_CLASS = '<>ArraySlices';

export class ArraySlices {
  /** @param host the generator: `{program, addSynthesizedBody(method, body)}` */
  constructor(host) {
    this.host = host;
    this.owner = null;
    this.methods = new Map();
  }
  /** `source[start..end]` as a new array; the operands are lowered expressions. */
  slice(elementType, source, start, end) {
    return n.call(this.methodFor(elementType), null, [source, start, end]);
  }
  methodFor(elementType) {
    let method = this.methods.get(elementType);
    if (method) return method;
    const program = this.host.program,
      arrayType = elementType + '[]';
    this.owner ??= program.addClass(SLICE_HELPER_CLASS);
    const parameters = [
      { name: 'source', type: arrayType },
      { name: 'start', type: 'int' },
      { name: 'end', type: 'int' },
    ];
    method = program.addMethod(this.owner, `GetSubArray(${elementType})`, { isStatic: true, returnType: arrayType, parameters });
    this.methods.set(elementType, method);
    const argument = index => n.parameter(n.newParameter(parameters[index].name, parameters[index].type, index)),
      result = n.newLocal('result', arrayType),
      index = n.newLocal('index', 'int');
    const copy = n.assign(n.arrayElement(n.local(result), n.local(index)), n.arrayElement(argument(0), n.binary('+', argument(1), n.local(index), 'int')));
    const next = n.assign(n.local(index), n.binary('+', n.local(index), n.literal(1, 'int'), 'int'));
    const loop = n.whileStatement(
      n.binary('<', n.local(index), n.arrayLength(n.local(result)), 'bool'),
      n.block([n.expressionStatement(copy), n.expressionStatement(next)]),
    );
    const length = n.binary('-', argument(2), argument(1), 'int');
    const body = [n.declare([[result, n.newArray(elementType, length)]]), n.declare([[index, n.literal(0, 'int')]]), loop, n.returnStatement(n.local(result))];
    this.host.addSynthesizedBody(method, n.block(body, [result, index]));
    return method;
  }
}
