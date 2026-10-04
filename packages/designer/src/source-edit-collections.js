import {generateDesignerNodeStatements} from './resource-codegen.js';
import {removeSourceStatement, sameSourceValue, sourceIdentifier, sourceInsertion} from './source-text.js';
import {failSource} from './source-errors.js';
import {sourceSpanLookup} from './source-spans.js';
import {unownedCollectionReference} from './source-collections.js';

/** Uses the shared item emitter with a per-plan name allocator, preserving unrelated handwritten locals. */
export function sourceCollectionStatements({design, node, variable, takenNames}) {
  const itemName = (_node, property, index) => {
    const stem = sourceIdentifier('item_' + variable + '_' + property + '_' + index);
    let name = stem;
    let suffix = 1;
    while (takenNames.has(name)) name = stem + '_' + suffix++;
    takenNames.add(name);
    return name;
  };
  return generateDesignerNodeStatements(design, {...node, bindings: {}, resourceReferences: {}}, variable, {itemName});
}

/** Replaces exclusively owned collection statements; dynamic or unknown Items operations are explicit barriers. */
export function sourceCollectionEdits(base, design, names, edits) {
  const previous = new Map(base.document.nodes.map(node => [node.id, node]));
  const takenNames = new Set([...base.context.symbols.map(symbol => symbol.name), ...names.values()]);
  const handwritten = sourceSpanLookup(base.unmanaged.map(item => item.statement), base.uri);
  for (const node of design.nodes) {
    const before = previous.get(node.id);
    if (!before) continue;
    const binding = base.bindings[node.id];
    const keys = new Set([...Object.keys(before.collections ?? {}), ...Object.keys(node.collections ?? {})]);
    for (const property of keys) {
      const oldItems = before.collections?.[property] ?? [];
      const newItems = node.collections?.[property] ?? [];
      if (sameSourceValue(oldItems, newItems)) continue;
      const collection = binding.collections?.[property];
      if (property !== 'Items' || binding.inline) failSource('Collection editing requires a named supported Items owner',
        binding.creation, 'SFSYNC_OWNERSHIP');
      if (collection?.dynamic || binding.properties[property]?.dynamic) {
        failSource(collection?.reason ?? 'This collection contains protected source operations', binding.creation, 'SFSYNC_DYNAMIC');
      }
      if (unownedCollectionReference(binding, base.method, handwritten)) {
        failSource('Handwritten code references this collection owner', binding.creation, 'SFSYNC_OWNERSHIP');
      }
      const statements = (collection?.entries ?? []).flatMap(entry => [...entry.dependencies, entry.statement]);
      const unique = [...new Map(statements.map(statement => [statement.uri + ':' + statement.start, statement])).values()];
      for (const statement of unique) edits.push(removeSourceStatement(base, statement));
      const lines = sourceCollectionStatements({design, node: {...node, collections: {[property]: newItems}},
        variable: names.get(node.id), takenNames});
      const at = unique.length ? Math.min(...unique.map(statement => statement.start)) : undefined;
      edits.push(sourceInsertion(base, lines, at));
    }
  }
}
