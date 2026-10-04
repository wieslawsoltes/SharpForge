import { join, relative } from 'node:path';

/** Retain portable argv arrays; paths stay data and are never interpolated into a shell. */
export function reproductionCommands(options, repository, results) {
  const output = relative(repository, options.output) || '.';
  const command = ['node', 'scripts/limited.js', 'node', 'scripts/conformance/fuzz/run.js'];
  const limits = ['--seed', String(options.seed), '--cases', String(options.budgets.maxCases),
    '--case-ms', String(options.budgets.caseTimeoutMs), '--campaign-ms', String(options.budgets.campaignTimeoutMs)];
  const selected = options.selected.length === 1 ? options.selected[0] : 'all';
  const selection = options.replay ? ['--replay', relative(repository, options.replay) || '.'] : ['--target', selected];
  return {
    workingDirectory: 'repository-root',
    note: 'Use the recorded source commit and environment. Each output directory must be new.',
    campaign: [...command, ...selection, ...limits, '--output', join(output, 'reproduction')],
    findings: results.filter(result => result.artifacts?.length).map(result => ({
      targetId: result.targetId,
      argv: [...command, '--replay', join(output, result.targetId, 'findings'), ...limits,
        '--output', join(output, result.targetId, 'replay')],
    })),
  };
}
