import { splitList, fail } from './errors.js';

export const portableTaskNames = Object.freeze([
  'Message', 'Warning', 'Error', 'PropertyGroup', 'ItemGroup', 'Copy', 'MakeDir', 'WriteLinesToFile',
  'ReadLinesFromFile', 'Touch', 'Delete', 'RemoveDir', 'CallTarget',
]);

/** Explicit task policy; arbitrary UsingTask assemblies and executables are never loaded. */
export function classifyTask(name) {
  return { name, portable: portableTaskNames.includes(name), requiresNative: !portableTaskNames.includes(name) };
}

export function recordTarget(context, node) {
  const name = context.expand(node.attributes.Name ?? '');
  if (!name) return context.diagnostic('Target requires a Name.', node, 'MSB4060');
  const target = {
    name, file: context.currentFile, attributes: { ...node.attributes }, tasks: node.children.map(task => task.name),
    nodes: node.children, start: node.start,
  };
  const existing = context.targets.findIndex(target => target.name.toLowerCase() === name.toLowerCase());
  if (existing >= 0) context.targets.splice(existing, 1);
  context.targets.push(target);
  for (const task of node.children) {
    if (!classifyTask(task.name).portable) {
      context.diagnostic(`Task '${task.name}' in target '${name}' requires native MSBuild.`, task, 'SFP1004');
    }
  }
}

/** Build a static target graph from final properties, preserving initial/default targets and incremental metadata. */
export function createTargetGraph(context, requested) {
  const targets = context.targets.map(target => ({
    ...target,
    dependsOnTargets: splitList(context.expand(target.attributes.DependsOnTargets)),
    beforeTargets: splitList(context.expand(target.attributes.BeforeTargets)),
    afterTargets: splitList(context.expand(target.attributes.AfterTargets)),
    inputs: context.expand(target.attributes.Inputs, { metadata: false }),
    outputs: context.expand(target.attributes.Outputs, { metadata: false }),
    portable: target.tasks.every(name => classifyTask(name).portable),
  }));
  const lookup = new Map(targets.map(target => [target.name.toLowerCase(), target]));
  const initialTargets = splitList(context.expand(context.targetAttributes.InitialTargets));
  const defaultTargets = splitList(context.expand(context.targetAttributes.DefaultTargets));
  const roots = requested === undefined ? defaultTargets.length ? defaultTargets : targets.slice(0, 1).map(target => target.name)
    : Array.isArray(requested) ? requested : splitList(requested);
  const before = new Map();
  const after = new Map();
  for (const target of targets) {
    for (const name of target.beforeTargets) before.set(name.toLowerCase(), [...(before.get(name.toLowerCase()) ?? []), target.name]);
    for (const name of target.afterTargets) after.set(name.toLowerCase(), [...(after.get(name.toLowerCase()) ?? []), target.name]);
  }
  const order = [];
  const complete = new Set();
  const active = new Set();
  const visit = (name, required = true) => {
    context.step();
    const key = name.toLowerCase();
    if (complete.has(key)) return;
    if (active.has(key)) fail(`Target dependency cycle contains '${name}'.`, 'MSB4006');
    const target = lookup.get(key);
    if (!target) {
      if (required) fail(`Target '${name}' does not exist in this project.`, 'MSB4057');
      return;
    }
    active.add(key);
    for (const dependency of target.dependsOnTargets) visit(dependency);
    for (const trigger of before.get(key) ?? []) visit(trigger);
    active.delete(key);
    complete.add(key);
    order.push(target.name);
    for (const trigger of after.get(key) ?? []) visit(trigger);
  };
  for (const name of [...initialTargets, ...roots]) visit(name, requested !== undefined || lookup.has(name.toLowerCase()));
  return { targets, initialTargets, defaultTargets, requestedTargets: roots, order };
}
