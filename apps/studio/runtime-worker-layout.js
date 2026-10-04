/** Layout events use the same cooperative pump as input, including windows whose entry point has already returned. */
export function registerRuntimeLayout(handlers, environment) {
  handlers.registerHandler('uiLayout', params => {
    const session = environment.session();
    if (session.vm.state === 'paused') return 0;
    const previous = session.vm.state;
    const result = session.vm.platform.updateLayout(params.changes);
    if (session.vm.state !== previous) environment.state();
    environment.schedule();
    return result;
  });
}
