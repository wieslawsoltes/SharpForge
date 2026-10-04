import { taskResult } from '@sharpforge/framework';

export function inferAwait(node) {
  return taskResult(this.infer(node.expression)) ?? 'error';
}

export function inferNested(node) {
  return this.infer(node.expression);
}

export function inferDeclaredType(node) {
  return this.c.typeName(node.type, this.m);
}

export function inferSwitchExpression(node) {
  return this.switchType(node);
}

export function inferInterpolatedString(node) {
  return 'string';
}

export function inferLiteral(node) {
  return node.type;
}

export function inferName(node) {
  return this.lookup(node.name)?.type ?? this.property(node)?.type ?? this.m.owner?.fields.find(f => f.name === node.name)?.type ?? 'error';
}

export function inferNew(node) {
  return this.c.typeName(node.type, this.m);
}

export function inferNewArray(node) {
  return node.type === 'var[]' ? (node.values?.length ? this.infer(node.values[0]) + '[]' : 'error[]') : node.type;
}

export function inferIndex(node) {
  const t = this.infer(node.target);
  return t.endsWith('[]') ? t.slice(0, -2) : 'error';
}

export function inferMember(node) {
  if (node.name === 'Length')
    return 'int';
  if (node.name === 'Message' && this.infer(node.target) === 'Exception' ||
      ['Name', 'FullName'].includes(node.name) && this.infer(node.target) === 'System.Type')
    return 'string';
  return this.property(node)?.type ?? this.field(node)?.type ?? 'error';
}

export function inferCall(node) {
  if (this.isNameof(node))
    return 'string';
  const builtin = this.findBuiltin(node);
  if (builtin)
    return builtin.result === 'numeric' ? node.args.some(a => this.infer(a) === 'double') ? 'double' : 'int' : builtin.result;
  return this.findMethod(node, false)?.returnType ?? 'error';
}

export function inferAssignment(node) {
  return this.infer(node.left);
}

export function inferConditional(node) {
  return this.infer(node.whenTrue);
}

export function inferUnary(node) {
  return node.operator === '!' ? 'bool' : this.infer(node.operand);
}

export function inferBinary(node) {
  if (['==', '!=', '<', '>', '<=', '>=', '&&', '||'].includes(node.operator))
    return 'bool';
  {
    const l = this.infer(node.left);
    const r = this.infer(node.right);
    if (node.operator === '+' && (l === 'string' || r === 'string'))
      return 'string';
    return l === 'double' || r === 'double' ? 'double' : l;
  }
}

export function inferUnknown(node) {
  return 'error';
}
