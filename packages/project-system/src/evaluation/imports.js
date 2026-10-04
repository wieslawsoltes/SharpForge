import { parseXml } from '../xml.js';
import { directoryName } from '../paths.js';
import { splitList, toBoolean, fail } from './errors.js';
import { evaluatePropertyGroup } from './properties.js';
import { recordTarget } from './targets.js';
import { resolveSdk, projectSdkReferences, applySdkPhase } from './sdk/resolver.js';

function inherited(context, name) {
  let directory = context.base;
  for (;;) {
    const candidate = directory ? directory + '/' + name : name;
    if (context.files.has(candidate)) return candidate;
    if (!directory) return null;
    directory = directoryName(directory);
  }
}

export function importDirectoryFile(context, kind) {
  const names = {
    props: ['importdirectorybuildprops', 'directorybuildpropspath', 'Directory.Build.props'],
    targets: ['importdirectorybuildtargets', 'directorybuildtargetspath', 'Directory.Build.targets'],
    packages: ['importdirectorypackagesprops', 'directorypackagespropspath', 'Directory.Packages.props'],
  };
  const [enabled, override, name] = names[kind];
  if (!toBoolean(context.properties[enabled], true)) return;
  const path = context.properties[override] ? context.resolvePath(context.expand(context.properties[override])) : inherited(context, name);
  if (path) {
    context.properties[override] = '/' + path;
    importFile(context, path, 0, { implicit: kind });
  }
}

function importNode(context, node, depth) {
  const sdk = node.attributes.Sdk;
  if (sdk) {
    const model = resolveSdk({ name: context.expand(sdk), version: node.attributes.Version }, context);
    const project = context.expand(node.attributes.Project);
    if (!['Sdk.props', 'Sdk.targets'].includes(project)) fail(`SDK import '${project}' is not modeled.`, 'SFP1004');
    applySdkPhase(context, model, project === 'Sdk.props' ? 'props' : 'targets');
    return;
  }
  const project = context.expand(node.attributes.Project);
  if (!project) fail('Import requires a Project path.', 'MSB4020');
  for (const value of splitList(project)) {
    const pattern = context.resolvePath(value, directoryName(context.currentFile));
    const paths = /[*?]/.test(pattern) ? context.pathIndex.glob(pattern) : [pattern];
    for (const path of paths) importFile(context, path, depth + 1, {
      label: node.attributes.Label ?? '', condition: node.attributes.Condition ?? '', sourceFile: context.currentFile, start: node.start,
    });
  }
}

function choose(context, node, depth) {
  if (depth >= context.limits.importDepth) fail('Choose nesting limit exceeded.', 'MSB0001');
  let branch = node.children.find(child => child.name === 'When' && context.enabled(child));
  branch ??= node.children.find(child => child.name === 'Otherwise');
  if (branch) walk(context, branch.children, depth + 1);
}

const handlers = {
  PropertyGroup: (context, node) => evaluatePropertyGroup(context, node, true),
  Import: importNode,
  ImportGroup: (context, node, depth) => walk(context, node.children, depth),
  Choose: choose,
  UsingTask(context, node) {
    context.usingTasks.push({ file: context.currentFile, ...node.attributes });
    context.diagnostic(`UsingTask '${node.attributes.TaskName ?? ''}' requires native MSBuild.`, node, 'SFP1004');
  },
  Sdk() {},
  ProjectExtensions() {},
};

function walk(context, children, depth) {
  for (const node of children) {
    context.step();
    if (node.name === 'ItemGroup') { context.itemGroups.push({ node, file: context.currentFile }); continue; }
    if (node.name === 'ItemDefinitionGroup') { context.definitionGroups.push({ node, file: context.currentFile }); continue; }
    if (node.name === 'Target') { recordTarget(context, node); continue; }
    if (!context.enabled(node)) continue;
    const handler = handlers[node.name];
    if (!handler) { context.diagnostic(`Project element '${node.name}' is not evaluated.`, node, 'SFP1004'); continue; }
    try { handler(context, node, depth); }
    catch (error) { context.diagnostic(error, node, node.name === 'Import' && error.code !== 'SFP1004' ? 'SFP1202' : undefined); }
  }
}

export function importFile(context, path, depth = 0, record = {}, root = null) {
  context.step();
  if (depth > context.limits.importDepth) fail('Project import nesting limit exceeded.', 'MSB0001');
  if (context.visited.has(path)) {
    context.diagnostic(`Duplicate or circular import '${path}' was skipped.`, null, 'SFP1201', 'warning');
    return;
  }
  if (context.visited.size >= context.limits.imports) fail('Project import file limit exceeded.', 'MSB0001');
  root ??= parseXml(context.system.text(path));
  if (root.name !== 'Project') fail(`Expected <Project> in import '${path}'.`, 'MSB4025');
  context.visited.add(path);
  context.imports.push(path);
  context.importRecords.push({ path, ...record });
  for (const name of splitList(root.attributes.TreatAsLocalProperty)) context.localProperties.add(name.toLowerCase());
  if (root.attributes.InitialTargets) {
    context.targetAttributes.InitialTargets = [context.targetAttributes.InitialTargets, root.attributes.InitialTargets].filter(Boolean).join(';');
  }
  if (!context.targetAttributes.DefaultTargets && root.attributes.DefaultTargets) context.targetAttributes.DefaultTargets = root.attributes.DefaultTargets;
  context.withFile(path, () => walk(context, root.children, depth));
}

export function evaluateImports(context, root) {
  const models = [];
  for (const reference of projectSdkReferences(root)) {
    try {
      const model = resolveSdk(reference, context);
      models.push(model);
      applySdkPhase(context, model, 'props');
    } catch (error) { context.diagnostic(error, root); }
  }
  importDirectoryFile(context, 'props');
  importDirectoryFile(context, 'packages');
  context.targetAttributes.DefaultTargets = root.attributes.DefaultTargets ?? '';
  importFile(context, context.path, 0, {}, root);
  importDirectoryFile(context, 'targets');
  for (const model of models) {
    try { applySdkPhase(context, model, 'targets'); }
    catch (error) { context.diagnostic(error, root); }
  }
}
