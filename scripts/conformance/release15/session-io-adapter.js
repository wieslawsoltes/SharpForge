import { join } from 'node:path';
import { Child } from '../acceptance/child.js';

/** An RPC acknowledgement precedes Python context-manager teardown; require the process to finish that teardown. */
export async function finishSessionIOBrowser(child, { timeoutMs = 30000 } = {}) {
  let timer;
  try {
    if (child.failure) throw child.failure;
    await child.request('close', {}, { timeout: 10000 });
    await Promise.race([
      child.closed,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Browser teardown did not finish before its deadline')), timeoutMs);
      }),
    ]);
    if (child.child.exitCode !== 0 || child.child.signalCode) {
      throw new Error(`Browser teardown exited ${child.child.exitCode ?? child.child.signalCode}; ${child.stderr}`);
    }
  } finally {
    clearTimeout(timer);
    await child.close();
  }
}

export function sessionIOBrowserAdapter(root, output) {
  const child = new Child(process.env.PYTHON ?? 'python3', [
    join(root, 'scripts/conformance/release15/session-io-driver.py'), output,
  ], {
    cwd: root,
    env: { ...process.env, PYTHONUNBUFFERED: '1', SHARPFORGE_RESULTS_DIR: output, SHARPFORGE_IN_MEMORY: '0',
      SHARPFORGE_BROWSER_URL: '', SERVE_ROOT: join(root, 'dist'), HOST: '127.0.0.1' },
  });
  return {
    child,
    step: (step, options) => child.request('step', step, options),
    close: () => finishSessionIOBrowser(child),
  };
}

/** The shared launcher writes this record only after CSP checks, tracing, contexts and its servers have closed. */
export function validateSessionIOBrowserClose(session, observation) {
  if (session?.suite !== 'studio-driver' || session.passed !== true || session.mode !== 'http'
    || session.engine !== observation.browser?.name || session.browser !== observation.browser?.version
    || !Array.isArray(session.cspViolations) || session.cspViolations.length
    || !Array.isArray(session.diagnosticErrors) || session.diagnosticErrors.length) {
    throw new Error('Production browser teardown, CSP or retained browser identity did not pass');
  }
}
