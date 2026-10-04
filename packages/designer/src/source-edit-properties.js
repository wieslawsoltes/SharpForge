import {CONTROLS} from '@sharpforge/framework';
import {propertySchema} from './model.js';
import {csharpValue} from './codegen.js';
import {sameSourceValue, removeSourceInitializer, removeSourceStatement, sourceInsertion} from './source-text.js';
import {sourceLiteralEdit} from './source-literals.js';
import {failSource} from './source-errors.js';

export function propertyStatement(node, key, name, value = node.properties[key]) {
  const property = propertySchema(node.type)[key];
  if (!property) failSource('Unsupported design property ' + key, null, 'SFSYNC_DYNAMIC');
  const expression = csharpValue(value, property.type);
  if (!property.attached) return `${name}.${key} = ${expression};`;
  const owner = key.startsWith('Wrap') ? 'VariableSizedWrapGrid' : ['Left', 'Top', 'ZIndex'].includes(key) ? 'Canvas' : 'Grid';
  return `${CONTROLS}${owner}.Set${key.replace(/^Wrap/, '')}(${name}, ${expression});`;
}

export function sourcePropertyEdits(base, next, names, edits) {
  const previous = new Map(base.document.nodes.map(node => [node.id, node]));
  const insertions = [];
  for (const node of next.nodes) {
    const before = previous.get(node.id);
    if (!before) continue;
    const binding = base.bindings[node.id];
    const inlineProperties = [];
    for (const key of new Set([...Object.keys(before.properties), ...Object.keys(node.properties)])) {
      if (sameSourceValue(before.properties[key], node.properties[key])) continue;
      const origin = binding.properties[key];
      if (origin?.dynamic) failSource(`'${binding.name}.${key}' is a dynamic C# expression. Edit it in C#.`,
        origin.expression, 'SFSYNC_DYNAMIC');
      if (!Object.hasOwn(node.properties, key)) {
        if (origin) {
          for (const entry of [...(origin.previous ?? []), origin]) {
            edits.push(entry.initializer ? removeSourceInitializer(base, entry) : removeSourceStatement(base, entry.statement));
          }
        }
      } else if (origin) {
        edits.push(sourceLiteralEdit(base.text, origin.expression, node.properties[key], propertySchema(node.type)[key].type));
      } else if (binding.inline) {
        const property = propertySchema(node.type)[key];
        if (property.attached) failSource('Attached setters require a named control', binding.creation, 'SFSYNC_OWNERSHIP');
        inlineProperties.push(`${key} = ${csharpValue(node.properties[key], property.type)}`);
      } else {
        insertions.push(propertyStatement(node, key, names.get(node.id)));
      }
    }
    if (inlineProperties.length) edits.push(inlinePropertyInsertion(base, binding, inlineProperties));
    eventEdits(base, before, node, binding, names.get(node.id), edits, insertions);
  }
  edits.push(sourceInsertion(base, insertions));
}

function inlinePropertyInsertion(base, binding, properties) {
  const creation = binding.creation;
  const initializers = creation.initializers ?? [];
  const last = initializers.at(-1);
  if (last) {
    const token = base.parsed.tokens.find(item => item.start >= last.expression.end);
    const comma = token?.kind === ',';
    const at = comma ? token.end : last.expression.end;
    return {start: at, end: at, text: (comma ? ' ' : ', ') + properties.join(', ') + (comma ? ',' : '')};
  }
  const closed = base.text[creation.end - 1] === '}';
  const at = creation.end - (closed ? 1 : 0);
  return {start: at, end: at, text: closed ? ' ' + properties.join(', ') + ' ' : ' { ' + properties.join(', ') + ' }'};
}

function eventEdits(base, before, node, binding, name, edits, insertions) {
  for (const event of new Set([...Object.keys(before.events), ...Object.keys(node.events)])) {
    if (before.events[event] === node.events[event]) continue;
    const origin = binding.events[event];
    if (binding.inline) failSource('Event subscriptions require a named control', binding.creation, 'SFSYNC_EVENT');
    if (origin?.dynamic) failSource('Multiple handlers and protected lambdas must be edited in C#', origin.expression, 'SFSYNC_EVENT');
    if (origin) {
      edits.push(node.events[event] ? {start: origin.expression.start, end: origin.expression.end, text: node.events[event]}
        : removeSourceStatement(base, origin.statement));
    } else if (node.events[event]) insertions.push(`${name}.${event} += ${node.events[event]};`);
  }
}

/** Symbol rename uses compiler-bound references, including references in sibling partial files. */
export function sourceRenameEdits(base, binding, newName) {
  if (!/^[A-Za-z_]\w*$/.test(newName)) failSource('A non-keyword C# identifier is required', binding.creation, 'SFSYNC_SYMBOL');
  const context = base.context;
  const symbol = context.symbols.find(candidate => candidate.id === binding.symbolId);
  if (!symbol) failSource('The control has no bound symbol; rename it after fixing C# binding errors', binding.creation, 'SFSYNC_SYMBOL');
  const collisions = context.symbols.filter(candidate => candidate.id !== symbol.id && candidate.name === newName
    && (candidate.owner === symbol.owner || candidate.method === symbol.method));
  if (collisions.length) failSource(`'${newName}' conflicts with an existing symbol`, binding.creation, 'SFSYNC_SYMBOL');
  const references = context.referencesBySymbol.get(symbol.id) ?? [];
  if (!references.length) failSource('No bound rename locations were found', binding.creation, 'SFSYNC_SYMBOL');
  return references.map(reference => ({uri: reference.uri, start: reference.start, end: reference.end, text: newName}));
}
