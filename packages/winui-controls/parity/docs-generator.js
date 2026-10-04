const cell = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');

/** Reference coverage, registry extensions and behavioral evidence are reported independently. */
export function generateParityMarkdown(matrix) {
  const { totals } = matrix;
  const percent = totals.denominator ? (100 * totals.api.present / totals.denominator).toFixed(2) : '0.00';
  const lines = ['# WinUI API reference and qualification', '',
    `Pinned Windows App SDK: **${matrix.windowsAppSDK}**.`, '',
    `The imported native reference contains **${totals.denominator} rows**. The registry exactly matches `
      + `**${totals.api.present} (${percent}%)**; **${totals.api.projection}** have a CLR accessor projection, `
      + `**${totals.api['signature-mismatch']}** have a different signature, and **${totals.api.missing}** are missing.`, '',
    `**${totals.behaviorVerified}** rows have hashed behavioral qualification evidence. API presence alone is not behavioral parity.`, '',
    `The registry contains **${totals.registryWinUITypes} WinUI/UI types** and **${totals.registryWinUIMembers} ABI members** `
      + 'in Microsoft.UI.* or Windows.UI.*. These registry counts exclude System/BCL, task and unrelated helper types. ', '',
    '## Reference boundaries', '', '| Namespace | Metadata imported |', '|---|---|'];
  for (const coverage of matrix.referenceCoverage) lines.push(`| ${cell(coverage.namespace)} | ${coverage.imported ? 'Yes' : 'Unavailable'} |`);
  lines.push('', 'An unavailable namespace has no invented denominator. Import the complete pinned metadata package set before '
    + 'claiming Windows App SDK coverage. The sealed reference inventory and its existing gap identifiers remain intact.', '',
  '## Per-type coverage', '', '| Type | Rows | Exact | Projection | Mismatch | Missing | Behavior verified |',
  '|---|---:|---:|---:|---:|---:|---:|');
  for (const type of matrix.types) lines.push(`| ${cell(type.type)} | ${type.total} | ${type.present} | ${type.projection} `
    + `| ${type.mismatched} | ${type.missing} | ${type.verified} |`);
  lines.push('', '## Behavior and compatibility policies', '', '| Policy | Status | Qualification |', '|---|---|---|');
  for (const policy of matrix.profileDeviations) lines.push(`| ${cell(policy.id)} | ${cell(policy.status)} | ${cell(policy.reason)} |`);
  lines.push('', '## Registry extensions and deviations', '',
    'Every WinUI registry member without an exact imported method signature is listed below. '
      + 'A profile extension is not counted as an implemented native member. A native property match does not hide a different accessor ABI.', '',
    '| Contract | Registered signature | Classification | Migration / native counterpart |', '|---:|---|---|---|');
  for (const deviation of matrix.deviations) lines.push(`| ${deviation.contractId} | ${cell(deviation.signature)} `
    + `| ${cell(deviation.kind)}: ${cell(deviation.reason)} | ${cell(deviation.migrationTargets.join('; '))} |`);
  lines.push('', '## Reproduction and evidence', '',
    'Generate this report with `node scripts/build-framework-api.js` after implementing the full scope. '
      + 'The command writes the matrix, deviations and gap export to `artifacts/results/a16-family-parity/` and checks for reference '
      + 'denominator or already-covered signature regressions.', '',
    'Optional behavior evidence must identify an exact reference key, test, SHA-256 of the result, engines and platforms. '
      + 'Unrun tests are never marked verified. See [the family profile](a16-control-family-profile.md) for bounded behavior and host capability requirements.', '',
    `Reference identity: \`${matrix.referenceSHA256}\`. Registry identity: \`${matrix.registrySHA256}\`.`, '');
  return lines.join('\n');
}
