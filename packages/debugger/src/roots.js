import {DebuggerRootScope} from '@sharpforge/runtime';

/** Variables/watch handles expire at resume; historical heaps remain independent snapshot copies. */
export function retainDebuggerValue(session, value) {
  let scope = session.debuggerRoots;
  if (!scope || scope.disposed) {
    scope = new DebuggerRootScope(session.vm.heap);
    session.debuggerRoots = scope;
    session.vm.gcRuntime?.debuggerScopes.add(scope);
    session.vm.gcRuntime?.debuggerSessions.add(session);
  }
  return scope.retain(value);
}

export function releaseDebuggerValues(session) {
  session.debuggerRoots?.clear();
  session.debuggerMemory?.clear();
}

export function disposeDebuggerValues(session) {
  session.debuggerMemory?.dispose();
  session.vm.gcRuntime?.debuggerScopes.delete(session.debuggerMemory);
  session.debuggerMemory = null;
  session.vm.gcRuntime?.debuggerSessions.delete(session);
  const scope = session.debuggerRoots;
  if (scope) {
    scope.dispose();
    session.vm.gcRuntime?.debuggerScopes.delete(scope);
  }
  session.debuggerRoots = null;
}
