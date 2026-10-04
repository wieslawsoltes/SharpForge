import {captureEvaluation} from './capture.js';
import {pairOrder, protocol} from './protocol.js';

export function assessmentPlaceholder() { return {passed: false, reason: 'Complete capture has not been assessed'}; }

/** Sequential process ownership and durable partial results, even when a later capture fails. */
export async function runEvaluation({engine, server, report, remaining, executablePath, save}) {
  for (let pair = 0; pair < protocol.pairs; pair++) {
    for (const [order, variant] of pairOrder(pair).entries()) {
      const run = {pair, order, variant, artifactSha256: report.identity.artifact.assetsSha256};
      report.runs.push(run);
      try {
        await captureEvaluation(engine, server.url, run,
          {executablePath, timeoutMs: Math.min(protocol.captureTimeoutMs, remaining())});
        report.environment.browserVersion ??= run.browserVersion;
        if (run.errors.length || server.failures.length) throw new Error('Product/server errors invalidate entry evaluation');
      } catch (error) {
        run.error = {name: error.name, message: error.message};
        throw error;
      } finally {
        report.serverErrors = [...server.failures];
        await save();
      }
    }
  }
}
