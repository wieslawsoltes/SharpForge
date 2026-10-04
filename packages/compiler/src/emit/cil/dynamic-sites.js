/** Microsoft.CSharp binder initialization and cached delegate dispatch (SF-A02-T55). */
import { RefKind } from '../../symbols/types.js';
import { fieldSignature } from '../../codegen/metadata/member-signatures.js';

function typeOf(emitter, type) {
  emitter.exprTypeOf({ operandType: type });
}

function typeArguments(emitter, argumentsList) {
  const il = emitter.il;
  if (!argumentsList?.length) return il.emit('ldnull');
  il.emit('ldc.i4', argumentsList.length).emit('newarr', emitter.tokens.type(emitter.core.type));
  argumentsList.forEach((argument, index) => {
    il.emit('dup').emit('ldc.i4', index);
    typeOf(emitter, argument);
    il.emit('stelem.ref');
  });
  return undefined;
}

function argumentInfos(emitter, site) {
  const il = emitter.il;
  il.emit('ldc.i4', site.arguments.length).emit('newarr', emitter.tokens.type(site.runtime.argumentInfo));
  site.arguments.forEach((argument, index) => {
    il.emit('dup').emit('ldc.i4', index).emit('ldc.i4', argument.flags);
    if (argument.name === null) il.emit('ldnull');
    else il.emit('ldstr', emitter.tokens.string(argument.name));
    il.emit('call', emitter.tokens.method(site.runtime.argumentFactory), { pops: 2, pushes: 1 }).emit('stelem.ref');
  });
}

/** Initialize once per lexical site and generic instantiation; racing initialization is the DLR's standard pattern. */
function initializeSite(emitter, site) {
  const il = emitter.il;
  const ready = il.newLabel();
  il.emit('ldsfld', site.field.token).emit('brtrue', ready).emit('ldc.i4', site.flags);
  if (site.name !== undefined && site.name !== null) il.emit('ldstr', emitter.tokens.string(site.name));
  if (site.operation === 'InvokeMember') typeArguments(emitter, site.typeArguments);
  if (site.operation === 'Convert') typeOf(emitter, site.returnType);
  if (site.operation === 'UnaryOperation' || site.operation === 'BinaryOperation') il.emit('ldc.i4', site.operator);
  typeOf(emitter, site.contextType);
  if (site.operation !== 'Convert' && site.operation !== 'IsEvent') argumentInfos(emitter, site);
  const factory = site.runtime.factory(site.operation);
  il.emit('call', emitter.tokens.method(factory), { pops: factory.parameters.length, pushes: 1 });
  const create = site.runtime.siteFactory;
  const shape = { isStatic: true, returnType: create.returnType, parameters: create.parameters };
  il.emit('call', emitter.tokens.external(site.siteType, create.name, shape), { pops: 1, pushes: 1 });
  il.emit('stsfld', site.field.token).mark(ready);
}

/** Push an argument as written, preserving reference identity and static type information. */
export function emitDynamicArgument(emitter, argument) {
  if (argument.staticType) return typeOf(emitter, argument.staticType);
  if (argument.refKind && argument.refKind !== RefKind.None) return emitter.address(argument.expression);
  return emitter.expression(argument.expression);
}

/** Execute a planned call site. Optional emitters replace operands already captured by a compound operation. */
export function emitDynamicSite(emitter, site, operands = null) {
  initializeSite(emitter, site);
  const il = emitter.il;
  const targetSignature = fieldSignature(emitter.tokens.definitionTypes, site.runtime.genericCallSite.typeParameters[0]);
  const target = emitter.tokens.builder.member(emitter.tokens.type(site.siteType), 'Target', targetSignature);
  il.emit('ldsfld', site.field.token).emit('ldfld', target);
  il.recordTop?.(site.delegate.type);
  il.emit('ldsfld', site.field.token);
  il.recordTop?.(site.siteType);
  site.arguments.forEach((argument, index) => {
    if (operands?.[index]) operands[index]();
    else emitDynamicArgument(emitter, argument);
    if (!argument.refKind || argument.refKind === RefKind.None) il.recordTop?.(argument.type);
  });
  const delegate = site.delegate;
  const invoke = delegate.invoke ? emitter.tokens.planned(delegate.invoke, delegate.definition)
    : emitter.tokens.external(delegate.type, 'Invoke', delegate.shape);
  const returnsValue = site.returnType.specialType !== 'System_Void';
  il.emit('callvirt', invoke, { pops: site.arguments.length + 2, pushes: returnsValue ? 1 : 0 });
  if (returnsValue) il.recordTop?.(site.returnType);
  return returnsValue ? undefined : false;
}
