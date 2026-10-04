import {controlFixture} from './control-fixture.js';

/** A single call site receives a chosen sequence of distinct virtual or interface receiver types. */
export function inlineCacheFixture(sequence = [0, 0, 0, 0], {interfaceCall = false, delta = 0} = {}) {
  const constructor = () => ({name: '.ctor', static: false, body: writer => writer.op('ret')});
  const types = [{name: 'Base', ...(interfaceCall ? {interface: true, flags: 0xa1} : {}), methods: [
    ...(interfaceCall ? [] : [constructor()]),
    {name: 'Value', static: false, result: 'int', flags: interfaceCall ? 0x5c6 : 0x1c6,
      ...(interfaceCall ? {} : {body: writer => writer.op('ldc.i4.0').op('ret')})}
  ]}];
  for (let index = 0; index < 6; index++) {
    types.push({name: 'Receiver' + index, ...(interfaceCall ? {interfaces: ['Base']} : {base: 'Base'}),
      methods: [constructor(), {name: 'Value', static: false, result: 'int', flags: interfaceCall ? 0x1c6 : 0xc6,
        body: writer => writer.op('ldc.i4', index + 1 + delta).op('ret')}]});
  }
  types.push({name: 'Program', methods: [
    {name: 'Main', result: 'int', body(writer, context) {
      writer.op('ldc.i4.0');
      for (const index of sequence) {
        writer.op('newobj', context.methods.get('Receiver' + index + '..ctor'));
        writer.op('call', context.methods.get('Program.Invoke')).op('add');
      }
      writer.op('ret');
    }},
    {name: 'Invoke', result: 'int', parameters: ['Base'], body(writer, context) {
      writer.op('ldarg.0').op('callvirt', context.methods.get('Base.Value')).op('ret');
    }}
  ]});
  return controlFixture(types);
}
