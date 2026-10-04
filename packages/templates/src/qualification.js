import { TemplateError } from './common.js';

/** Require observed passes for every catalog entry on an explicitly selected target. No target can imply another. */
export function validateTemplateQualifications(catalog, { target, observations = [], kind = 'project' } = {}) {
  if (typeof target !== 'string' || !target) throw new TemplateError('SFTPL020', 'A qualification target is required');
  const observed = new Map();
  for (const observation of observations) {
    if (observation.target !== target) continue;
    if (observed.has(observation.template)) throw new TemplateError('SFTPL020', 'Duplicate template qualification: ' + observation.template);
    observed.set(observation.template, observation);
  }
  const missing = [];
  for (const template of catalog.list({ kind })) {
    if (!template.targets?.includes(target)) continue;
    const result = observed.get(template.id);
    if (!result || result.status !== 'passed' || !result.engine || !result.evidence) {
      missing.push({ template: template.id, target, status: result?.status ?? 'unqualified', prerequisites: template.prerequisites ?? [] });
    }
  }
  if (missing.length) {
    const error = new TemplateError('SFTPL020', 'Unqualified template targets: ' + missing.map(item => item.template + '/' + target).join(', '));
    error.targets = missing;
    throw error;
  }
  return { target, qualified: [...observed.values()].filter(result => result.status === 'passed') };
}
