/** Fixed, finite tooling fixtures. None is selectable by an ordinary campaign. */
export const selfChecks = Object.freeze({
  'harness-accepted': { run: () => ({ status: 'accepted' }) },
  'harness-rejected': { run: () => ({ status: 'rejected', code: 'FIXTURE_REJECTED' }) },
  'harness-overrun': {
    async run() {
      await new Promise(resolve => setTimeout(resolve, 500));
      return { status: 'accepted' };
    },
  },
  'harness-allocation': {
    run() {
      const retained = new Uint8Array(4 * 1024 * 1024);
      retained.fill(1);
      return { status: 'accepted', retained };
    },
  },
  'harness-failure': { run() { throw new TypeError('Owned harness failure fixture'); } },
  'harness-output': {
    run() {
      process.stdout.write('x'.repeat(8192));
      return { status: 'accepted' };
    },
  },
  'harness-disposal': {
    run() {
      setTimeout(() => {}, 500);
      return { status: 'accepted' };
    },
  },
});
