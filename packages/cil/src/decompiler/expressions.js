export const numericTypes = new Set([
  'int', 'uint', 'long', 'ulong', 'short', 'ushort', 'byte', 'sbyte', 'nint', 'nuint', 'double', 'float', 'char',
]);

const aliases = Object.freeze({
  'System.Int32': 'int', 'System.Int64': 'long', 'System.Boolean': 'bool', 'System.Double': 'double',
  'System.Single': 'float', 'System.String': 'string', 'System.Object': 'object', 'System.Char': 'char',
});

export function typeName(name) {
  return aliases[name] ?? name.replaceAll('+', '.');
}

export function identifier(name) {
  const value = name.replace(/[^\p{L}\p{N}_]/gu, '_');
  return /^\p{N}/u.test(value) ? `_${value}` : value;
}

/** Per-method state for the existing conservative stack-to-expression lowering. */
export class ExpressionContext {
  constructor(inspector, method) {
    this.inspector = inspector;
    this.method = method;
    this.stack = [];
    this.statements = [];
    this.temporary = 0;
    this.reachable = true;
  }

  pop() {
    if (!this.stack.length) throw new Error('Control-flow stack merge requires SSA reconstruction');
    return this.stack.pop();
  }

  push(text, type = 'int') {
    this.stack.push({ text, type });
  }

  coerce(value, type) {
    if (value.type === type) return value.text;
    if (type === 'bool' && numericTypes.has(value.type)) return `(${value.text} != 0)`;
    if (value.type === 'bool' && numericTypes.has(type)) return `(${value.text} ? 1 : 0)`;
    return value.text;
  }

  truth(value) {
    return value.type === 'bool' ? value.text : `(${value.text} != ${numericTypes.has(value.type) ? '0' : 'null'})`;
  }

  argument(index) {
    const { signature, owner } = this.method;
    if (!signature.isStatic && index === 0) return { text: 'this', type: owner };
    const position = index - (signature.isStatic ? 0 : 1);
    return { text: `arg${position}`, type: signature.parameters[position] };
  }

  emit(statement) {
    this.statements.push(`    ${statement}`);
  }

  capture(text, type = 'int') {
    const name = `stack${this.temporary++}`;
    this.emit(`${typeName(type)} ${name} = ${text};`);
    this.push(name, type);
  }
}
