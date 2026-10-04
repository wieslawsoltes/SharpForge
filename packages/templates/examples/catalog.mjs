import { createProjectPlan, createItemPlan, searchTemplates } from '../src/index.js';

const projects = searchTemplates({ kind: 'project' });
const items = searchTemplates({ kind: 'item' });
for (const template of projects) {
  const plan = createProjectPlan(template.id, { projectName: 'Example', solutionFormat: 'slnx' });
  console.log(template.id, plan.records.length + ' files', template.targets.join(', '), plan.warnings.join(' '));
}
for (const template of items) {
  const plan = createItemPlan(template.id, { namespace: 'Example' });
  console.log(template.id, plan.records.map(record => record.path).join(', '));
}
