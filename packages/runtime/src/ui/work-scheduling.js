const terminal = new Set(['completed', 'faulted', 'canceled']);

/** Native UI work wakes an idle interpreter; existing managed contexts still own execution and waits. */
export function wakeManagedUIWork(vm) {
  if (!['terminated', 'waiting'].includes(vm.state) || vm.frames.length || vm.scheduler.suppressed) return;
  vm.scheduler.ensure();
  vm.state = 'ready';
}

/** A synchronous native callback may enqueue an async kickoff without changing its interrupted context. */
export function resumeManagedUIWork(vm, pending = false) {
  if (vm.frames.length || !['ready', 'running', 'terminated', 'waiting'].includes(vm.state) || vm.scheduler.suppressed) return;
  const scheduler = vm.scheduler;
  if (!scheduler.enabled) return;
  const next = scheduler.choose();
  if (next) { scheduler.load(next); return; }
  const live = [...scheduler.contexts.values()].some(context => !terminal.has(context.status));
  scheduler.parked = live;
  const main = scheduler.contexts.get(1);
  vm.state = pending ? 'ready' : live ? 'waiting' : main?.status === 'faulted' ? 'faulted' : 'terminated';
}
