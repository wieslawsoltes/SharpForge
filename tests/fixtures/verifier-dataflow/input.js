import { managedFixture } from '../../managed-fixtures.js';

export const nativeCases = [
  { name: 'Empty', body: writer => writer.op('ret'), accepted: true },
  { name: 'Balanced', maxStack: 1, body: writer => writer.op('ldc.i4.1').op('pop').op('ret'), accepted: true },
  { name: 'Underflow', body: writer => writer.op('pop').op('ret'), diagnostic: 'StackUnderflow' },
  { name: 'Overflow', maxStack: 0, body: writer => writer.op('ldc.i4.1').op('pop').op('ret'), diagnostic: 'StackOverflow' },
  { name: 'Join', body(writer) {
    writer.op('ldc.i4.0').op('brtrue.s', 'extra').op('br.s', 'join');
    writer.mark('extra').op('ldc.i4.1').mark('join').op('ret');
  }, diagnostic: 'PathStackDepth' },
  { name: 'Diamond', body(writer) {
    writer.op('ldc.i4.0').op('brtrue.s', 'right').op('ldc.i4.1').op('br.s', 'join');
    writer.mark('right').op('ldc.i4.2').mark('join').op('pop').op('ret');
  }, accepted: true },
  { name: 'Loop', body(writer) {
    writer.mark('loop').op('ldc.i4.0').op('brtrue.s', 'loop').op('ret');
  }, accepted: true },
  { name: 'Switch', body(writer) {
    writer.op('ldc.i4.0').op('switch', ['done', 'done', 'done']).mark('done').op('ret');
  }, accepted: true },
  { name: 'Catch', body(writer) {
    writer.mark('try').op('ldnull').op('throw').mark('catch').op('pop').op('leave.s', 'done');
    writer.mark('done').op('ret');
  }, handlers(labels, context) {
    return [{ start: labels.get('try'), end: labels.get('catch'), target: labels.get('catch'),
      handlerEnd: labels.get('done'), catchType: context.resolve('System.Exception') }];
  }, accepted: true },
  { name: 'Finally', body(writer) {
    writer.mark('try').op('leave.s', 'done').mark('finally').op('endfinally').mark('done').op('ret');
  }, handlers(labels) {
    return [{ start: labels.get('try'), end: labels.get('finally'), target: labels.get('finally'),
      handlerEnd: labels.get('done'), flags: 2, catchType: 0 }];
  }, accepted: true },
];

export function dataflowFixture(fixture) {
  return managedFixture({ methods: [{ name: 'Main', maxStack: 8, ...fixture }] });
}
