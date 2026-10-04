import {n} from './node-factory.js';

/** Property access nodes retain their lvalue protocol while their accessor calls use checked UI dispatch. */
export function uiAccessorForwarder(profile, symbol) {
  if (!symbol) return null;
  profile.accessors ??= new Map();
  if (profile.accessors.has(symbol)) return profile.accessors.get(symbol);
  const g = profile.g;
  profile.accessorOwner ??= g.program.addClass('SharpForge.<>UIAccessors');
  const parameters = [{name: 'receiver', type: 'object'}, ...g.parametersOf(symbol)];
  const resultType = g.types.imageType(symbol.returnType);
  const method = g.program.addMethod(profile.accessorOwner, symbol.name + '$' + profile.accessors.size,
    {isStatic: true, parameters, returnType: resultType});
  profile.accessors.set(symbol, method);
  const receiver = n.parameter(n.newParameter('receiver', 'object', 0));
  const args = parameters.slice(1).map((p, index) => n.parameter(n.newParameter(p.name, p.type, index + 1)));
  let call;
  if (profile.dispatches(symbol, null)) call = profile.invoke(symbol, receiver, args);
  else if (g.isSource(symbol)) call = n.call(g.methodOf(symbol), receiver, args);
  else call = n.frameworkCall(symbol, receiver, args, resultType);
  const statements = [];
  if (resultType === 'void') statements.push(n.expressionStatement(call));
  else {
    const result = n.newLocal('$result', resultType);
    statements.push(n.declare([[result, call]]), n.returnStatement(n.local(result)));
  }
  g.addSynthesizedBody(method, n.block(statements));
  return method;
}
