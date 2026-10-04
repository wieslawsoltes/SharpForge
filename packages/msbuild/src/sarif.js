/** Convert SARIF 2.1 compiler diagnostics without discarding suppression and related-location metadata. */
export function parseSarif(input, { project = null, maxResults = 100000 } = {}) {
  if (typeof input === 'string' && input.length > 64 * 1024 * 1024) throw new Error('SARIF size limit exceeded');
  const document = typeof input === 'string' ? JSON.parse(input) : input;
  if (document?.version !== '2.1.0' || !Array.isArray(document.runs)) throw new Error('Expected SARIF 2.1.0');
  const diagnostics = [];
  for (const run of document.runs) {
    const rules = new Map((run.tool?.driver?.rules ?? []).map(rule => [rule.id, rule]));
    for (const result of run.results ?? []) {
      if (diagnostics.length >= maxResults) throw new Error('SARIF result limit exceeded');
      const rule = rules.get(result.ruleId) ?? run.tool?.driver?.rules?.[result.ruleIndex] ?? {};
      const physical = result.locations?.[0]?.physicalLocation, region = physical?.region;
      diagnostics.push({ code: result.ruleId ?? rule.id ?? 'SARIF', severity: result.level === 'error' ? 'error' :
        result.level === 'note' || result.level === 'none' ? 'info' : 'warning',
        message: result.message?.text ?? result.message?.markdown ?? '', file: physical?.artifactLocation?.uri ?? null,
        line: region?.startLine ?? null, column: region?.startColumn ?? null,
        endLine: region?.endLine ?? null, endColumn: region?.endColumn ?? null, project,
        helpUri: rule.helpUri ?? null, suppressions: result.suppressions ?? [],
        suppressed: (result.suppressions ?? []).some(item => item.status !== 'rejected'),
        relatedLocations: result.relatedLocations ?? [], properties: result.properties ?? {} });
    }
  }
  return diagnostics;
}
