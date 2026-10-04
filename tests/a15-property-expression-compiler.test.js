import test from 'node:test';
import assert from 'node:assert/strict';
import {compileBindingDescriptor, parseCompiledBindingExpression, evaluateCompiledExpression} from '@sharpforge/winui-properties';

const path = token => ({kind: 'path', steps: [{token}]});
const types = new Map([['Model', {name: 'Model', token: 0x02000001}], ['Format', {name: 'Format', token: 0x02000002}]]);
const members = new Map([
  ['Model.Name', {token: 0x17000001, type: 'string'}], ['Model.Child', {token: 0x17000002, type: 'Model'}],
  ['Model.Items', {token: 0x17000003, type: 'List'}], ['Model.Enabled', {token: 0x17000004, type: 'bool'}],
  ['Model.ReadOnly', {token: 0x17000005, type: 'string', writable: false}],
  ['List.Item', {token: 0x17000006, type: 'Model', arguments: ['int']}]
]);
const methods = [
  {owner: 'Model', name: 'Format', parameters: ['string'], returnType: 'string', token: 0x06000001},
  {owner: 'Format', name: 'Join', parameters: ['string', 'string'], returnType: 'string', isStatic: true, token: 0x06000002},
  {owner: 'Model', name: 'Click', parameters: ['object', 'object'], returnType: 'void', token: 0x06000003},
  {owner: 'Model', name: 'NoArgs', parameters: [], returnType: 'void', token: 0x06000004},
  {owner: 'Model', name: 'SetName', parameters: ['string'], returnType: 'void', token: 0x06000005}
];
const symbols = {
  type: name => types.get(name),
  member(type, name, {arguments: args = []} = {}) {
    const member = members.get(type + '.' + name);
    return member && JSON.stringify(member.arguments ?? []) === JSON.stringify(args) ? member : null;
  },
  method(type, name, args, {staticOnly = false} = {}) {
    return methods.find(method => method.owner === type && method.name === name && (!staticOnly || method.isStatic)
      && JSON.stringify(method.parameters) === JSON.stringify(args));
  }
};
const compile = (expression, options = {}) => compileBindingDescriptor({symbols, rootType: 'Model', expression,
  target: {id: 'caption', token: 0x17000007}, ...options});

test('A15 expression compilation replaces member names with authoritative metadata tokens', () => {
  const descriptor = compile('Items[2].Child?.Name');
  assert.equal(descriptor.mode, 'OneTime');
  assert.deepEqual(descriptor.expression.steps.map(step => step.token), [0x17000003, 0x17000006, 0x17000002, 0x17000001]);
  assert.equal(descriptor.expression.steps[3].nullConditional, true);
  assert.equal(descriptor.expression.steps[1].arguments[0].value, 2);
  for (const name of ['Items', 'Child', 'Name']) assert.equal(JSON.stringify(descriptor).includes('"' + name + '"'), false);
  assert(Object.isFrozen(descriptor.expression.steps));
});

test('A15 function compilation supports instance/static calls and typed cast tokens', () => {
  const instance = compile('Format(Name)');
  assert.equal(instance.expression.token, 0x06000001);
  assert.equal(instance.expression.receiver.kind, 'path');
  const staticCall = compile('Format.Join(Name, "suffix")');
  assert.equal(staticCall.expression.token, 0x06000002);
  assert.equal(staticCall.expression.receiver, undefined);
  const cast = compile('((Model)Child).Name');
  assert.equal(cast.expression.root.kind, 'cast');
  assert.equal(cast.expression.root.token, 0x02000001);
});

test('A15 event compilation binds declared zero-argument or sender/args signatures', () => {
  const withArgs = compile('Click', {kind: 'event'});
  assert.equal(withArgs.expression.token, 0x06000003);
  assert.deepEqual(withArgs.expression.arguments.map(argument => argument.name), ['sender', 'eventArgs']);
  const without = compile('NoArgs', {kind: 'event'});
  assert.equal(without.expression.arguments.length, 0);
  assert.throws(() => compile('Format(Name)', {kind: 'event'}), {code: 'SFXB004'});
});

test('A15 BindBack adds a typed contextual value and read-only TwoWay paths are rejected', () => {
  const descriptor = compile('Name', {mode: 'TwoWay', bindBack: 'SetName', targetValueType: 'string'});
  assert.equal(descriptor.bindBack.token, 0x06000005);
  assert.equal(descriptor.bindBack.arguments[0].name, 'value');
  assert.throws(() => compile('ReadOnly', {mode: 'TwoWay'}), {code: 'SFXB006'});
  assert.throws(() => compile('Name', {kind: 'load', target: {id: 'owner', name: 'deferred'}}), {code: 'SFXB004'});
  assert.equal(compile('Enabled', {kind: 'load', target: {id: 'owner', name: 'deferred'}}).kind, 'load');
});

test('A15 malformed, missing-token, wrong-index and wrong-arity expressions fail without reflective fallback', () => {
  for (const expression of ['Name.', 'Items[', 'Format(,Name)', 'Name + Name', 'Name => Name', 'Name[1,2]']) {
    assert.throws(() => compile(expression), {code: 'SFXB002'}, expression);
  }
  assert.throws(() => compile('Missing'), {code: 'SFXB003'});
  assert.throws(() => compile('Items["wrong"]'), {code: 'SFXB003'});
  assert.throws(() => compile('Format()'), {code: 'SFXB005'});
  assert.throws(() => compile('Format(1)'), {code: 'SFXB005'});
  assert.throws(() => compile('((Missing)Child).Name'), {code: 'SFXB004'});
  assert.throws(() => parseCompiledBindingExpression('Name', {maxNodes: 0}), RangeError);
  assert.throws(() => parseCompiledBindingExpression('Child.Name', {maxNodes: 1}), {code: 'SFXB002'});
});

test('A15 token execution honors null-conditional steps and validates type tokens', () => {
  const source = {child: null};
  const expression = compile('Child?.Name').expression;
  let reads = 0;
  assert.equal(evaluateCompiledExpression(expression, {source, services: {
    get(receiver, token) { reads++; assert.equal(token, 0x17000002); return receiver.child; }
  }}), null);
  assert.equal(reads, 1);
  assert.throws(() => evaluateCompiledExpression({kind: 'cast', token: 0x02000001, value: path(0x17000002)}, {
    source, services: {get: () => ({}), isType: () => false}
  }), {kind: 'InvalidCastException'});
});
