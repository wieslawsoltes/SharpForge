import {baseName} from '../paths.js';
import {explorerNodeId} from './node-identity.js';

const groups = [
  {label: 'Frameworks', kind: 'framework', key: 'frameworks'},
  {label: 'Packages', kind: 'package', key: 'packageReferences'},
  {label: 'Projects', kind: 'project-reference', key: 'projectReferences'},
  {label: 'Assemblies', kind: 'reference', key: 'references'},
  {label: 'Analyzers', kind: 'analyzer', key: 'analyzers'}
];

function dependencyNode(value, options, ancestry = new Set()) {
  const item = typeof value === 'string' ? {name: value} : value;
  const identity = String(item.name ?? item.id ?? item.path ?? item.include ?? '');
  if (!identity || ancestry.has(identity) || ancestry.size > 64) {
    return {id: explorerNodeId('cycle', options.parent, identity), kind: 'diagnostic', label: 'Dependency cycle: ' + identity,
      badge: '⚠', draggable: false, diagnostic: {code: 'SFP2401', message: 'Dependency cycle or depth limit'}};
  }
  const node = {id: explorerNodeId(options.kind, options.parent, identity), kind: options.kind,
    label: options.kind === 'project-reference' ? baseName(item.path ?? identity) : identity,
    path: item.path, project: options.project, metadata: item, badge: item.version ?? '',
    icon: options.kind === 'package' ? '▣' : '◇', draggable: false};
  const diagnostic = item.diagnostic ?? item.diagnostics?.find(value => value.severity === 'error' || value.severity === 'warning');
  if (item.resolved === false || diagnostic) {
    node.warning = true;
    node.badge = [item.version, '⚠'].filter(Boolean).join(' ');
    node.diagnostic = diagnostic ?? {code: 'SFP2402', message: 'Unresolved dependency: ' + identity};
    node.description = node.diagnostic.message;
  }
  if (options.kind === 'package' && item.dependencies) {
    const children = Array.isArray(item.dependencies) ? item.dependencies :
      Object.entries(item.dependencies).map(([name, version]) => ({name, version}));
    const visited = new Set(ancestry).add(identity);
    const seen = new Set();
    node.children = children.map(child => typeof child === 'string' ? options.packages.get(child) ?? child :
      {...options.packages.get(child.name ?? child.id), ...child}).map(child => dependencyNode(child,
      {...options, parent: node.id}, visited)).filter(child => !seen.has(child.id) && seen.add(child.id));
    node.branch = node.children.length > 0;
  }
  return node;
}

function contextsOf(project) {
  const contexts = project.contexts instanceof Map ? [...project.contexts.values()] :
    Array.isArray(project.contexts) ? project.contexts : Object.values(project.contexts ?? {});
  const frameworks = project.targetFrameworks?.length ? project.targetFrameworks : [project.targetFramework].filter(Boolean);
  if (contexts.length) return contexts;
  return frameworks.map(targetFramework => ({...project, targetFramework, contexts: undefined}));
}

/** Dependencies are isolated by target context and identified by logical name; assets children preserve unresolved diagnostics. */
export function buildDependencyTree(project, projectId) {
  const root = {id: projectId + ':dependencies', kind: 'dependencies', label: 'Dependencies', project: project.path,
    branch: true, draggable: false, icon: '▱', children: []};
  const contexts = contextsOf(project);
  for (const context of contexts.length ? contexts : [project]) {
    const framework = context.targetFramework ?? '';
    const parent = contexts.length > 1 ? {id: explorerNodeId('target', root.id, framework), kind: 'target-framework',
      label: framework, project: project.path, branch: true, draggable: false, icon: '◇', children: []} : root;
    if (parent !== root) root.children.push(parent);
    const assets = context.assetsGraph ?? project.assetsGraph?.targets?.[framework] ?? project.assetsGraph ?? {};
    const packages = new Map((assets.packages ?? []).map(item => [item.name ?? item.id, item]));
    for (const group of groups) {
      let values = context[group.key] ?? project[group.key] ?? [];
      if (group.kind === 'framework' && !values.length && framework) values = [{name: framework}];
      if (group.kind === 'package') values = values.map(item => typeof item === 'string' ? packages.get(item) ?? item :
        {...packages.get(item.name ?? item.id), ...item});
      if (!values.length && !framework) continue;
      const node = {id: explorerNodeId('group', parent.id, group.kind), kind: 'dependency-group', label: group.label,
        project: project.path, branch: true, draggable: false, icon: '▱', children: []};
      const seen = new Set();
      node.children = values.map(value => dependencyNode(value, {kind: group.kind, parent: node.id, project: project.path, packages}))
        .filter(child => !seen.has(child.id) && seen.add(child.id));
      parent.children.push(node);
    }
  }
  return root;
}
