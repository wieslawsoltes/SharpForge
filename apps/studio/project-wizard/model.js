import { createProjectPlan, createItemPlan, defaultNamespace, searchTemplates } from '../../../packages/templates/src/index.js';

const dir = path => path?.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

export class WizardModel {
  constructor(context, { kind, add, node }) {
    this.context = context;
    this.kind = kind;
    this.add = add;
    this.node = node;
    const candidate = node?.project ?? (node?.kind === 'project' ? node.path : !node ? context.startup : null);
    this.projectPath = candidate?.endsWith('.csproj') ? candidate : null;
    const project = context.snapshot?.projects?.find(item => item.path === this.projectPath);
    const folder = kind === 'item' ? node?.kind === 'folder' ? node.path :
      ['source', 'file'].includes(node?.kind) ? dir(node.path) : dir(this.projectPath) : '';
    this.values = {
      projectName: 'Application', solutionName: 'Application', namespace: kind === 'project' ? 'Application' :
        project?.properties?.rootnamespace ?? defaultNamespace(project?.name ?? 'Application'), location: folder,
      framework: 'net10.0', sameDirectory: false, checked: false, solutionMode: add && context.solutionPath ? 'existing' : 'new',
      destination: add && context.native ? 'native' : 'browser', name: 'Class1.cs', nullable: 'disable',
      implicitUsings: false, useProgramMain: true, noRestore: true, namespaceStyle: 'block', solutionFormat: 'slnx'
    };
    this.selected = kind === 'item' ? 'class' : 'console';
    this.step = 0;
    this.query = '';
    this.category = '';
    this.language = '';
    this.directoryHandle = null;
    this.preview = null;
  }
  get templates() { return searchTemplates({ kind: this.kind }); }
  get template() { return this.templates.find(template => template.id === this.selected); }
  filtered() { return searchTemplates({ kind: this.kind, query: this.query, category: this.category, language: this.language }); }
  plan(current) {
    if (current.identity !== this.context.identity) throw new Error('Workspace changed while the wizard was open; cancel and reopen it');
    const existing = this.add || this.values.destination === 'native' ?
      [...current.records, ...current.folders.map(path => ({ path, directory: true }))] : [];
    if (this.kind === 'item') {
      const projectText = this.projectPath ? current.records.find(record => record.path === this.projectPath)?.text : null;
      return createItemPlan(this.selected, { ...this.values, folder: this.values.location,
        projectPath: this.projectPath, projectText: projectText ?? null, existing });
    }
    return createProjectPlan(this.selected, {
      ...this.values, solutionPath: this.values.solutionMode === 'existing' ? this.context.solutionPath : null,
      solutionText: this.values.solutionMode === 'existing' ? current.records.find(file => file.path === this.context.solutionPath)?.text : null,
      solutionFolder: this.node?.solutionFolder, existing, environment: { native: !!current.native, platform: current.platform }
    });
  }
  set(key, value) {
    if (key === 'projectName') {
      if (this.values.solutionName === this.values.projectName) this.values.solutionName = value;
      if (this.values.namespace === defaultNamespace(this.values.projectName)) this.values.namespace = defaultNamespace(value);
    }
    this.values[key] = value;
  }
}
