import { ExplorerResourceState } from './explorer-resource-state.js';
import { resourceTransactionError } from './explorer-resource-errors.js';
import { normalizeResourcePlan, validateResourcePaths, prepareResourceWrites, prepareResourceProjectWrites } from './explorer-resource-plan.js';

/** Stage versioned text edits, C# resource renames and literal XML references before one Explorer ownership commit. */
export async function applyExplorerResourceTransaction(input, { documents, explorer, signal } = {}) {
  const plan = normalizeResourcePlan(input);
  const state = new ExplorerResourceState(documents, explorer, signal);
  const created = new Set();
  try {
    state.cancelled();
    validateResourcePaths(plan, state);
    const writes = await prepareResourceWrites(plan, state, created);
    const projectWrites = await prepareResourceProjectWrites(plan, state);
    const mappings = plan.resources.map(resource => ({ from: resource.oldUri, to: resource.newUri }));
    const moves = mappings.map(mapping => ({ kind: 'move', path: mapping.from, destination: mapping.to }));
    const validate = () => state.validate();
    validate();
    await explorer.perform([...writes, ...moves, ...projectWrites], mappings, { validate });
    return { applied: true, changes: plan.changes, resources: plan.resources };
  } catch (error) {
    throw resourceTransactionError(error);
  } finally {
    for (const model of created) if (!documents.ownsModel(model)) model.dispose();
  }
}
