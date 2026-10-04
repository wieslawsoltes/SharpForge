import { setCaseInsensitive } from './errors.js';

export function setProperty(context, name, value, node) {
  name = name.toLowerCase();
  if (context.reserved.has(name)) {
    context.diagnostic(`Reserved property '${name}' cannot be changed.`, node, 'MSB4004');
    return;
  }
  if (context.globals.has(name) && !context.localProperties.has(name)) return;
  context.properties[name] = value;
}

export function evaluatePropertyGroup(context, group, conditionEvaluated = false) {
  if (!conditionEvaluated && !context.enabled(group)) return;
  for (const property of group.children) {
    if (!context.enabled(property)) continue;
    try { setProperty(context, property.name, context.expand(property.text.trim(), { decode: false }), property); }
    catch (error) { context.diagnostic(error, property); }
  }
}

export function evaluateDefinitions(context) {
  for (const { node, file } of context.definitionGroups) context.withFile(file, () => {
    if (!context.enabled(node)) return;
    for (const item of node.children) {
      if (!context.enabled(item)) continue;
      const metadata = context.definitions[item.name] ??= Object.create(null);
      const current = { itemType: item.name, identity: '', metadata, definingProject: file };
      context.withItem(current, () => {
        for (const child of item.children) {
          if (!context.enabled(child)) continue;
          try { setCaseInsensitive(metadata, child.name, context.expand(child.text.trim())); }
          catch (error) { context.diagnostic(error, child); }
        }
      });
    }
  });
}
