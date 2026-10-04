import { managedFixture } from '../../managed-fixtures.js';

function nestedCatchBody(writer, nonempty) {
  writer.mark('outer').op('ldnull').op('throw').mark('outerEnd').mark('outerHandler');
  if (!nonempty) writer.op('pop');
  writer.mark('try').op(nonempty ? 'pop' : 'nop').op('leave', 'afterInner').mark('tryEnd');
  writer.mark('handler').op('pop').op('leave', 'afterInner').mark('handlerEnd').mark('afterInner');
  writer.op('leave', 'done').mark('outerHandlerEnd').mark('done').op('ret');
  return writer.labels.get('try');
}

/** Author entry heights independently of the compiler and the execution verifier. */
export function entryFixture({ nonempty = false, branch = false, flags = 0, shared = false,
  dead = false, handlerPop = false, noHandlers = false, nestedCatch = false } = {}) {
  let entryOffset;
  const bytes = managedFixture({ name: 'HandlerEntry', methods: [{ name: 'Main',
    body(writer) {
      if (noHandlers) { writer.op('ret'); return; }
      if (nestedCatch) { entryOffset = nestedCatchBody(writer, nonempty); return; }
      if (dead) writer.op('br', 'done');
      if (nonempty) writer.op('ldc.i4.1');
      if (branch) writer.op('br', 'try');
      writer.mark('try');
      entryOffset = writer.labels.get('try');
      writer.op(nonempty ? 'pop' : 'nop').op('leave', 'done').mark('tryEnd').mark('handler');
      if (flags === 0) writer.op('pop').op('leave', 'done');
      else {
        if (handlerPop) writer.op('pop');
        writer.op('endfinally');
      }
      writer.mark('handlerEnd');
      if (shared) writer.mark('second').op('pop').op('leave', 'done').mark('secondEnd');
      writer.mark('done').op('ret');
    },
    handlers(labels, { md }) {
      if (noHandlers) return [];
      const first = { flags, start: labels.get('try'), end: labels.get('tryEnd'),
        target: labels.get('handler'), handlerEnd: labels.get('handlerEnd'),
        catchType: flags === 0 ? md.typeRef(shared ? 'System.InvalidOperationException' : 'System.Exception') : 0 };
      if (nestedCatch) return [first, { ...first, start: labels.get('outer'), end: labels.get('outerEnd'),
        target: labels.get('outerHandler'), handlerEnd: labels.get('outerHandlerEnd') }];
      return shared ? [first, { ...first, target: labels.get('second'), handlerEnd: labels.get('secondEnd'),
        catchType: md.typeRef('System.Exception') }] : [first];
    },
  }] });
  return { bytes, entryOffset };
}

export const nativeCases = [
  ...[0, 2, 4].flatMap(flags => [false, true].map(nonempty => ({
    name: `${['catch', '', 'finally', '', 'fault'][flags]}-${nonempty ? 'nonempty' : 'empty'}`,
    options: { flags, nonempty }, accepted: !nonempty,
  }))),
  { name: 'branch-empty', options: { branch: true }, accepted: true },
  { name: 'branch-nonempty', options: { branch: true, nonempty: true }, accepted: false },
  { name: 'shared-empty', options: { shared: true }, accepted: true },
  { name: 'shared-nonempty', options: { shared: true, nonempty: true }, accepted: false },
  { name: 'nested-catch-consumed', options: { nestedCatch: true }, accepted: true },
  { name: 'nested-catch-seed', options: { nestedCatch: true, nonempty: true }, accepted: false },
];
