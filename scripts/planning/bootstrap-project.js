import { parseArgs } from 'node:util';
import { GitHubProject } from './lib/github-project.js';
import { isMain } from './lib/io.js';
export const REQUIRED_FIELDS = [
  { name: 'Agent', dataType: 'TEXT' }, { name: 'Lease expires', dataType: 'DATE' }, { name: 'Branch', dataType: 'TEXT' }, { name: 'Lock keys', dataType: 'TEXT' },
  { name: 'Area', dataType: 'TEXT' }, { name: 'Parity percent', dataType: 'NUMBER' }
];
export const REQUIRED_LABELS = [
  { name: 'agent:claimed', color: '1d76db', description: 'Leaf work reserved by an agent' },
  { name: 'lease:expired', color: 'd93f0b', description: 'Ownership retained; explicit reconciliation required' },
  { name: 'status:blocked', color: 'b60205', description: 'Blocked by a named prerequisite' },
  { name: 'contract-change', color: '5319e7', description: 'Versioned incompatible contract change' },
  ...Array.from({ length: 30 }, (_, n) => ({ name: `area:A${String(n).padStart(2, '0')}`, color: '0e8a16', description: `SharpForge area A${String(n).padStart(2, '0')}` }))
];
export function bootstrapPlan(fields, labels) {
  const errors = [], operations = [];
  for (const field of REQUIRED_FIELDS) {
    const existing = fields.find(f => f.name === field.name);
    if (!existing) operations.push({ type: 'field', ...field });
    else if (existing.dataType !== field.dataType) errors.push(`Field ${field.name} has ${existing.dataType}; expected ${field.dataType}`);
  }
  for (const label of REQUIRED_LABELS) if (!labels.some(l => l.name === label.name)) operations.push({ type: 'label', ...label });
  return { operations, errors, views: { automated: false, reason: 'Project views cannot be created by the public GraphQL API', manual: ['Ready queue: status:Ready', 'By agent: group Agent', 'Epics: kind:Epic', 'Expiring leases: sort Lease expires'] } };
}
export async function bootstrap(client, { dryRun = true } = {}) {
  const project = await client.project(), labels = await client.pages('labels'), plan = bootstrapPlan(project.fields, labels);
  if (plan.errors.length) throw new Error(plan.errors.join('\n'));
  if (!dryRun) for (const op of plan.operations) {
    if (op.type === 'label') { const { type, ...body } = op; await client.api('POST', 'labels', body); }
    else await client.graphql('mutation CreateField($project:ID!,$name:String!,$type:ProjectV2CustomFieldType!){createProjectV2Field(input:{projectId:$project,name:$name,dataType:$type}){projectV2Field{... on ProjectV2Field{id}}}}', { project: project.id, name: op.name, type: op.dataType });
  }
  client.cachedProject = null;
  return { dryRun, ...plan };
}
if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { owner: { type: 'string', default: 'wieslawsoltes' }, repo: { type: 'string', default: 'SharpForge' }, project: { type: 'string', default: '4' }, apply: { type: 'boolean' }, 'dry-run': { type: 'boolean' } } });
  if (values.apply && values['dry-run']) throw new Error('--apply and --dry-run are mutually exclusive');
  console.log(JSON.stringify(await bootstrap(new GitHubProject({ ...values, number: values.project }), { dryRun: !values.apply }), null, 2));
}
