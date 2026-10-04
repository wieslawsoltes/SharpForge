import test from 'node:test';
import assert from 'node:assert/strict';
import {NamedTypeSymbol, TypeParameterSymbol, ArrayTypeSymbol, PointerTypeSymbol, FunctionPointerTypeSymbol}
  from '../packages/compiler/src/symbols/types.js';
import {MethodSymbol, ParameterSymbol} from '../packages/compiler/src/symbols/members.js';
import {interfaceParametersMatch, interfaceTypeMatches} from '../packages/compiler/src/binder/interface-signatures.js';

function method(parameterName, signature, refKind = 'none') {
  const parameter = new TypeParameterSymbol({name: parameterName});
  const type = signature(parameter);
  return new MethodSymbol({name: 'Read', typeParameters: [parameter], returnType: type,
    parameters: [new ParameterSymbol({name: 'value', type, refKind})]});
}

test('interface signature identity substitutes Unicode method parameters through arrays and constructed types', () => {
  const box = new NamedTypeSymbol({name: 'Box', arity: 1});
  const signature = parameter => box.construct(new ArrayTypeSymbol(parameter, 2));
  const left = method('Ω', signature);
  const right = method('Ж', signature);
  assert(interfaceParametersMatch(left, right));
  assert(interfaceTypeMatches(left.returnType, right.returnType, left, right));
});

test('interface signature identity substitutes pointer and function-pointer components structurally', () => {
  const signature = parameter => new FunctionPointerTypeSymbol({returnType: parameter,
    parameters: [{type: new PointerTypeSymbol(parameter), refKind: 'ref'}]});
  const left = method('First', signature);
  const right = method('Second', signature);
  assert(interfaceParametersMatch(left, right));
  assert.equal(interfaceParametersMatch(left, method('Third', signature, 'ref')), false);
});

test('named types that shadow generic parameter names never acquire positional identity', () => {
  const namedT = new NamedTypeSymbol({name: 'T'});
  const namedU = new NamedTypeSymbol({name: 'U'});
  const left = method('T', () => namedT);
  const right = method('U', () => namedU);
  assert.equal(interfaceParametersMatch(left, right), false);
  assert.equal(interfaceTypeMatches(left.returnType, right.returnType, left, right), false);
  const sameNameDifferentDefinition = method('T', () => new NamedTypeSymbol({name: 'T'}));
  assert.equal(interfaceParametersMatch(left, sameNameDifferentDefinition), false);
});
