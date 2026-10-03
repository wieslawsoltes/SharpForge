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
  const explicit = target.typeArguments?.map(type => compiler.c.resolveType(type, node, false, compiler.m));
  const first = arguments_[0];
  const array = first?.kind === 'RefArgument' ? compiler.infer(first.expression) : null;
  const candidates = templates.flatMap(descriptor => {
    if (explicit && explicit.length !== descriptor.genericArity) return [];
    const element = descriptor.genericArity ? explicit?.[0] ?? (array?.endsWith('[]') ? array.slice(0, -2) : null) : null;
    if (descriptor.genericArity && !element) return [];
    return [{descriptor, parameters: descriptor.parameters.map(type => type.replaceAll('!!0', element ?? '!!0')),
      result: descriptor.returnType.replaceAll('!!0', element ?? '!!0')}];
  }).filter(item => item.parameters.length === arguments_.length && item.parameters.every((expected, index) => {
    const argument = arguments_[index];
    const actual = compiler.infer(argument?.kind === 'RefArgument' ? argument.expression : argument);
    if (expected.endsWith('&')) return argument?.kind === 'RefArgument' && argument.modifier === 'ref' && actual === expected.slice(0, -1);
    if (argument?.kind === 'RefArgument') return false;
    if (expected === 'System.Array') return arrayType(actual);
    if (expected === 'object') return actual !== 'void';
    return actual === expected || expected === 'long' && actual === 'int';
  }));
  candidates.sort((left, right) => left.parameters.filter(type => type === 'long').length - right.parameters.filter(type => type === 'long').length);
  if (!candidates.length) {
    if (report) compiler.c.report(node, 'CS1501', ['Array.' + name, arguments_.length]);
    return {error: true, result: 'error'};
  }
  return {...candidates[0], arguments: arguments_, receiver: staticCall ? null : target.target};
}

export function emitArrayBuiltin(compiler, binding) {
  if (binding.error) { compiler.emitConstant(null); return 'error'; }
  if (binding.receiver) compiler.expr(binding.receiver);
  binding.arguments.forEach((argument, index) => {
    const expected = binding.parameters[index];
    if (expected.endsWith('&')) compiler.synchronizationAddress(argument.expression);
    else if (expected === 'System.Array' || expected === 'object') compiler.expr(argument);
    else compiler.checkAssign(expected, compiler.typedExpr(argument, expected), argument);
  });
  const builtin = Builtins.find(entry => entry?.arrayRuntime === binding.descriptor);
  compiler.emit(Op.BUILTIN, builtin.id, binding.arguments.length + Number(!!binding.receiver));
  return binding.result;
}
