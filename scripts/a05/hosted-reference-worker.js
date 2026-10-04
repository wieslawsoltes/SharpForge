import {writeFileSync} from 'node:fs';
import {loadProfilerReference} from '../../bench/vm/profiler-reference.js';
import {isMain} from '../../bench/vm/evidence.js';

// Only the post-install child loads benchmark/runtime dependencies; setup imports the pure launcher.
if (isMain(import.meta.url)) {
  const [manifestPath, output, ...extra] = process.argv.slice(2);
  const report = {format: 'SharpForge.HostedProfilerReferenceValidation/1', startedAt: new Date().toISOString(),
    command: [process.execPath, ...process.execArgv, ...process.argv.slice(1)], status: 'failed'};
  try {
    if (!manifestPath || !output || extra.length) throw new TypeError('Use MANIFEST OUTPUT');
    const {manifest} = await loadProfilerReference(manifestPath);
    Object.assign(report, {status: 'validated', sourceCommit: manifest.sourceCommit,
      referenceCommit: manifest.referenceCommit, patchSha256: manifest.patchSha256,
      scope: 'Existing strict parent, full patch, transform, dependency and clean-reference verification after profiling-off.'});
  } catch (error) {
    report.error = {name: error.name, message: error.message, stack: error.stack};
    process.exitCode = 1;
  }
  report.completedAt = new Date().toISOString();
  if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  process.stdout.write(report.status + '\n');
}
