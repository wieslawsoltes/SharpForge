import { managedFixture } from '../../managed-fixtures.js';

/** Independently authored EH transfers; no compiler or admission logic produces these bodies. */
export function flowFixture({ mode = 'valid', flags = 0, noHandlers = false } = {}) {
  let sourceOffset;
  const bytes = managedFixture({ name: 'EhAdmission', methods: [{ name: 'Main',
    body(writer) {
      if (noHandlers) { writer.op('ret'); return; }
      if (mode === 'branch-handler') writer.op('ldnull').mark('source').op('br', 'handler');
      if (mode === 'branch-middle') writer.mark('source').op('br', 'interior');
      if (mode === 'branch-first') writer.op('br', 'try');
      if (mode === 'leave-middle') writer.mark('source').op('leave', 'interior');
      writer.mark('try').op('nop').mark('interior');
      if (mode === 'branch-exit') writer.mark('source').op('br', 'done');
      else if (mode === 'return') writer.mark('source').op('ret');
      else if (mode === 'fallthrough') writer.mark('source').op('nop');
      else if (mode === 'switch-exit') writer.op('ldc.i4.0').mark('source').op('switch', ['done']).op('leave', 'done');
      else writer.op('leave', 'done');
      writer.mark('tryEnd').mark('handler');
      if (flags === 0) writer.op('pop').op(mode === 'rethrow' ? 'rethrow' : 'leave', mode === 'rethrow' ? undefined : 'done');
      else {
        if (mode === 'handler-escape') writer.mark('source').op('leave', 'done');
        writer.op('endfinally');
      }
      writer.mark('handlerEnd').mark('done').op('ret');
      sourceOffset = writer.labels.get('source');
    },
    handlers(labels, { md }) {
      if (noHandlers) return [];
      const clause = { flags, start: labels.get('try') + (mode === 'boundary' ? 2 : 0), end: labels.get('tryEnd'),
        target: labels.get('handler'), handlerEnd: labels.get('handlerEnd'), catchType: flags ? 0 : md.typeRef('System.Exception') };
      return mode === 'overlap' ? [clause, { ...clause }] : [clause];
    },
  }] });
  return { bytes, sourceOffset };
}

export const nativeCases = [
  ...[0, 2, 4].map(flags => ({ name: 'valid-' + flags, options: { flags }, accepted: true })),
  { name: 'rethrow', options: { mode: 'rethrow' }, accepted: true },
  { name: 'first-try-entry', options: { mode: 'branch-first' }, accepted: true },
  ...[
    ['branch-exit', 'CILCF0008', 'BranchOutOfTry'], ['branch-middle', 'CILCF0009', 'BranchIntoTry'],
    ['branch-handler', 'CILCF0009', 'BranchIntoHandler'], ['leave-middle', 'CILCF0019', 'LeaveIntoTry'],
    ['switch-exit', 'CILCF0008', 'BranchOutOfTry'], ['return', 'CILCF0002', 'ReturnFromTry'],
    ['fallthrough', 'CILCF0010', 'FallthroughException'],
  ].map(([mode, diagnostic, nativeError]) => ({ name: mode, options: { mode }, accepted: false, diagnostic, nativeError })),
  ...[2, 4].map(flags => ({ name: 'handler-escape-' + flags, options: { mode: 'handler-escape', flags }, accepted: false,
    diagnostic: 'CILCF0015', nativeError: flags === 2 ? 'LeaveOutOfFinally' : 'LeaveOutOfFault' })),
];
