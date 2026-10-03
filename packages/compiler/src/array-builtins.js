import {Op, Builtins, arrayIntrinsicDefinitions} from '@sharpforge/bytecode';

const arrayType = type => typeof type === 'string' && /\[[,*]*\]$/.test(type);
const pathOf = node => node?.kind === 'Name' ? node.name : node?.kind === 'Member' && pathOf(node.target)
  ? pathOf(node.target) + '.' + node.name : null;

/** Bind source Array contracts independently of numeric and framework overloads. */
export function bindArrayBuiltin(compiler, node, report = false) {
  const property = node?.kind === 'Member';
  if (!property && node?.kind !== 'Call') return null;
  const target = property ? node : node.target;
  if (target?.kind !== 'Member') return null;
  const path = pathOf(target.target);
  const staticCall = ['Array', 'System.Array'].includes(path) && !compiler.lookup(path.split('.')[0]);
  const receiverType = staticCall ? null : compiler.infer(target.target);
  if (!staticCall && !arrayType(receiverType)) return null;
  const name = property ? 'get_' + target.name : target.name;
  const arguments_ = property ? [] : node.args;
  const templates = arrayIntrinsicDefinitions.filter(item => item.name === name && item.isStatic === staticCall);
  if (!templates.length) return null;
  const candidates = templates.filter(item => item.parameters.length === arguments_.length && item.parameters.every((expected, index) => {
    const argument = arguments_[index];
    const actual = compiler.infer(argument?.kind === 'RefArgument' ? argument.expression : argument);
    if (expected === '!!0[]&') return argument?.kind === 'RefArgument' && argument.modifier === 'ref' && actual.endsWith('[]');
    if (argument?.kind === 'RefArgument') return false;
    if (expected === 'System.Array') return arrayType(actual);
    if (expected === 'object') return actual !== 'void';
    return actual === expected || expected === 'long' && actual === 'int';
  }));
  candidates.sort((left, right) => left.parameters.filter(type => type === 'long').length - right.parameters.filter(type => type === 'long').length);
  if (!candidates.length) {
    if (report) compiler.c.report(node, 'CS1501', 'No supported Array.' + name + ' overload accepts these arguments');
    return {error: true, result: 'error'};
  }
  const descriptor = candidates[0];
  return {descriptor, arguments: arguments_, receiver: staticCall ? null : target.target, result: descriptor.returnType};
}

export function emitArrayBuiltin(compiler, binding) {
  if (binding.error) { compiler.emitConstant(null); return 'error'; }
  if (binding.receiver) compiler.expr(binding.receiver);
  binding.arguments.forEach((argument, index) => {
    const expected = binding.descriptor.parameters[index];
    if (expected.endsWith('&')) compiler.synchronizationAddress(argument.expression);
    else if (expected === 'System.Array' || expected === 'object') compiler.expr(argument);
    else compiler.checkAssign(expected, compiler.typedExpr(argument, expected), argument);
  });
  const builtin = Builtins.find(entry => entry.arrayRuntime === binding.descriptor);
  compiler.emit(Op.BUILTIN, builtin.id, binding.arguments.length + Number(!!binding.receiver));
  return binding.result;
}
