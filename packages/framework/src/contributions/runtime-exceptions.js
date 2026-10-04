/** AppDomain notifications use the A05 reservation; released framework IDs stay fixed. */
export function registerRuntimeExceptions({
  define,
  delegate,
  event,
  prop,
  ctor,
  types
}) {
  const domain = 'System.AppDomain';
  const first = 'System.Runtime.ExceptionServices.FirstChanceExceptionEventArgs';
  const unhandled = 'System.UnhandledExceptionEventArgs';
  if (!types.has('System.Exception')) define('System.Exception', {kind: 'exception'});
  if (!types.has('System.EventArgs')) define('System.EventArgs');
  define(domain, {
    kind: 'exception-events'
  });
  define(first, {
    kind: 'exception-events',
    base: 'System.EventArgs'
  });
  define(unhandled, {
    kind: 'exception-events',
    base: 'System.EventArgs'
  });
  delegate('System.EventHandler`1<' + first + '>', ['object', first]);
  delegate('System.UnhandledExceptionEventHandler', ['object', unhandled]);
  prop(domain, 'CurrentDomain', domain, null, true, true);
  event(domain, 'FirstChanceException', 'System.EventHandler`1<' + first + '>');
  event(domain, 'UnhandledException', 'System.UnhandledExceptionEventHandler');
  ctor(first, ['System.Exception']);
  prop(first, 'Exception', 'System.Exception', null, true);
  ctor(unhandled, ['object', 'bool']);
  prop(unhandled, 'ExceptionObject', 'object', null, true);
  prop(unhandled, 'IsTerminating', 'bool', false, true);
}
