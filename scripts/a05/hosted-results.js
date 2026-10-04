import {hostedMemoryResult} from './hosted-memory-results.js';

const exactRows = (actual, expected) => Array.isArray(actual) && actual.length === expected.length &&
  new Set(actual.map(row => row.id)).size === expected.length && actual.every(row => expected.includes(row.id));

/** Interpret only the existing driver's declared gate or reporting scope; retain its raw exit separately. */
export function assessHostedResult(command, processResult, report, commit) {
  const failed = reason => ({status: 'unmet', reason});
  if (!['reference', 'gate', 'target', 'differential', 'profiler-off', 'profiler-on', 'float',
    'snapshot', 't12', 'latency'].includes(command.kind)) return failed('Unknown qualification scope');
  if (processResult.cancelled || processResult.signal || processResult.error) return failed('Process failed or was interrupted');
  if (!report) return failed('Required report is missing');
  if (command.kind === 'reference') {
    return processResult.exitCode === 0 && report.status === 'created' && report.sourceCommit === commit ?
      {status: 'satisfied', scope: 'reference-setup'} : failed('Reference setup did not complete');
  }
  if (report.commit !== commit || report.completedCommit !== commit || report.worktreeStatus !== '' ||
      report.completedWorktreeStatus !== '' || report.errors?.length !== 0) return failed('Incomplete or invalid source/report provenance');
  if (command.kind === 'gate') {
    return processResult.exitCode === 0 && report.status === 'qualified' && report.qualification?.status === 'stable' ?
      {status: 'satisfied', scope: 'two-complete-run-repeatability'} : failed('T12 baseline is not qualified');
  }
  if (report.status !== 'measured') return failed('Measurement is incomplete');
  if (command.rows.length && (!exactRows(report.rows, command.rows) ||
      report.rows.some(row => !['measured', 'passed'].includes(row.status)))) return failed('Selected row coverage is incomplete');
  if (command.kind === 'profiler-on') {
    return processResult.exitCode === 2 && report.profilerCoverage?.enabledOverhead?.missing?.length === 0 ?
      {status: 'satisfied', scope: 'six-enabled-overhead-observations', rawAcceptance: report.acceptance} :
      failed('Enabled overhead reporting did not complete');
  }
  if (command.kind === 'float') {
    return processResult.exitCode === 2 && hostedMemoryResult('float', report) ?
      {status: 'satisfied', scope: 'warmed-per-iteration-allocation-only', rawAcceptance: report.acceptance,
        limit: 'Separate float differential required; all-host-objects-per-run remains unqualified.'} :
      failed('Original per-iteration allocation clause is not met');
  }
  if (processResult.exitCode !== 0) return failed('Driver returned an unmet or inconclusive result');
  if (['target', 'differential', 'profiler-off'].includes(command.kind) && report.acceptance !== 'met') {
    return failed('Required existing target was not met');
  }
  if (command.kind === 'snapshot' && !hostedMemoryResult('snapshot', report)) {
    return failed('Original 128-snapshot workload did not qualify');
  }
  if (command.kind === 't12' && (report.rows?.length !== 36 || report.protocol?.samples !== 100 ||
      report.protocol?.suite !== 'all' || report.rows.some(row => row.status !== 'measured'))) {
    return failed('T12 requires all 36 measured rows');
  }
  return {status: 'satisfied', scope: command.kind === 'latency' ? 'correctness-and-latency-reporting-no-speed-threshold' : command.kind};
}

export function aggregateHostedResults(records) {
  const unmet = records.filter(record => record.assessment?.status !== 'satisfied').map(record => record.id);
  return {status: unmet.length ? 'unmet' : 'satisfied', unmet,
    scope: 'Only the preselected hosted measurement queue; not whole-project, native or browser acceptance.'};
}
