import {cloneWorkspaceRecord, isTextRecord, recordText, compilationRecords} from './workspace-records.js';
import { normalizePath } from './paths.js';
import { WorkspacePathIndex } from './evaluation/path-index.js';
import { evaluateProjectContexts } from './multi-target.js';
import { ProjectContextSelection, findProjectContext } from './context-selection.js';
import { loadProjectSystem } from './project-loader.js';
import { combinedCompilationOptions } from './evaluation/compiler-options.js';
import { createBuildPlan, createBuildUnit } from './build-plan.js';
import { resolveBuildContextGraph } from './build-contexts.js';
import { createOutputLayout } from './output-layout.js';
import { projectRunOptions } from './launch-settings.js';
import { runPortableTargets } from './evaluation/target-runner.js';
import { resourceEvaluationInputs } from './resources.js';
import { buildContextFile } from './evaluation/target-files.js';

/** Own portable project evaluation, selected contexts and virtual build outputs for one workspace. */
export class ProjectSystem {
  constructor(files, options = {}) {
    const { configuration = 'Debug', platform = 'AnyCPU', targetFramework = '', properties = {}, maxFiles = 5000 } = options;
    this.options = options;
    this.files = new Map();
    this.projects = new Map();
    this.evaluationContexts = new Map();
    this.evaluationContextVariants = new Map();
    this.contextSelection = new ProjectContextSelection();
    this.contextOptions = new Map();
    this.diagnostics = [];
    this.configuration = configuration;
    this.platform = platform;
    this.targetFramework = targetFramework;
    this.globalProperties = Object.fromEntries(Object.entries(properties).map(([key, value]) => [key.toLowerCase(), String(value)]));
    const input = files instanceof Map ? [...files].map(([path, value]) => typeof value === 'string'
      ? { path, text: value } : cloneWorkspaceRecord(value, path)) : files;
    if (!Array.isArray(input) || input.length > maxFiles) throw new Error('Workspace file limit exceeded');
    for (const file of input) {
      const path = normalizePath(file.path ?? file.uri);
      if (this.files.has(path)) throw new Error(`Duplicate workspace path: ${path}`);
      const lazy = file.lazy === true && Number.isFinite(file.size) && file.size >= 0;
      if (!isTextRecord(file) && !(file.bytes instanceof Uint8Array) && !lazy) {
        throw new Error(`No file contents: ${path}`);
      }
      this.files.set(path, cloneWorkspaceRecord(file, path));
    }
    this.pathIndex = new WorkspacePathIndex(this.files.keys(), options);
  }
  diagnostic(path, message, severity = 'warning', code = 'SFP1001') {
    const diagnostic = { path, message, severity, code };
    if (!this.diagnostics.some(value => value.path === path && value.message === message)) {
      this.diagnostics.push(diagnostic);
    }
    return diagnostic;
  }
  text(path) {
    const file = this.files.get(path);
    if (!isTextRecord(file)) {
      throw new Error(`Missing text file '${path}'. Open its containing folder to grant access to sibling files.`);
    }
    return recordText(file);
  }
  load(entry) {
    return loadProjectSystem(this, entry);
  }
  evaluateProject(path) {
    return evaluateProjectContexts(this, normalizePath(path));
  }
  /** Read a generated output from its exact framework context, with ordinary workspace files as fallback. */
  buildFile(path, { contextId } = {}) {
    return buildContextFile(this, normalizePath(path), contextId);
  }
  /** Read one prepared context without materializing any later project's compilation inputs. */
  buildUnit(startup, contextId) {
    return createBuildUnit(this, startup, contextId);
  }
  /** Hydration replaces both ordinary records and any context-specific metadata-only output. */
  setBuildFile(path, record, { contextId } = {}) {
    path = normalizePath(path);
    if (!isTextRecord(record) && !(record?.bytes instanceof Uint8Array)) {
      throw new Error('Hydration did not return file contents.');
    }
    const file = cloneWorkspaceRecord(Object.defineProperties({}, {
      ...Object.getOwnPropertyDescriptors(record),
      lazy: {value: false, writable: true, configurable: true, enumerable: true},
    }), path);
    this.files.set(path, file);
    this.pathIndex.add(path);
    const context = this.evaluationContextVariants.get(contextId);
    if (context?.targetFiles?.has(path)) context.targetFiles.set(path, file);
    return file;
  }
  /** Read the active context, a stable ID or a subset of framework/runtime/configuration dimensions. */
  getContext(path, selector) {
    path = normalizePath(path);
    if (selector === undefined) return this.contextSelection.get(path);
    return findProjectContext(this.projects.get(path)?.contexts ?? [], selector);
  }
  /** Re-evaluate all affected snapshots after selecting a project's framework/runtime/options. */
  selectContext(path, selector) {
    path = normalizePath(path);
    const selected = typeof selector === 'string' ? this.getContext(path, selector) : selector;
    if (!selected || !this.projects.has(path)) throw new Error('Requested project context was not loaded.');
    const options = { ...this.contextOptions.get(path) };
    for (const key of ['targetFramework', 'runtimeIdentifier', 'configuration', 'platform']) {
      if (selected[key] !== undefined) {
        if (typeof selected[key] !== 'string' || selected[key].length > 256) {
          throw new Error('Invalid project context dimension: ' + key);
        }
        options[key] = selected[key];
      }
    }
    const previous = this.contextOptions.get(path);
    this.contextOptions.set(path, options);
    try {
      const project = this.evaluateProject(path);
      this.projects.set(path, project);
      this.load(this.solution.path);
      return this.projects.get(path);
    } catch (error) {
      if (previous) this.contextOptions.set(path, previous);
      else this.contextOptions.delete(path);
      throw error;
    }
  }
  snapshot() {
    return {
      solution: this.solution,
      projects: [...this.projects.values()],
      diagnostics: [...this.diagnostics],
      configuration: this.configuration,
      platform: this.platform,
    };
  }
  /** Legacy source-combined preview. Prefer buildPlan() for assembly isolation. */
  compilationFiles(startup = this.solution?.projectPaths[0], { includeAssemblyInfo = false } = {}) {
    if (!this.projects.has(startup)) throw new Error('Startup project was not loaded');
    const sources = new Map();
    const seen = new Set();
    const visit = path => {
      if (seen.has(path)) return;
      seen.add(path);
      const project = this.projects.get(path);
      if (!project || project.unloaded) return;
      for (const reference of project.projectReferences) visit(reference.path);
      for (const item of project.compile) {
        const file = this.buildFile(item.path, { contextId: project.contextId });
        if (file?.lazy) throw new Error(`Compile file '${item.path}' must be hydrated before compilation.`);
        if (isTextRecord(file)) sources.set(item.path, file);
      }
      for (const source of project.generatedSources ?? []) {
        if (source.kind === 'assembly-info' && !includeAssemblyInfo) {
          this.diagnostic(project.path, 'Generated assembly attributes require an assembly-emission host; use buildPlan() to retain them.',
            'warning', 'SFP1405');
          continue;
        }
        sources.set(source.path, { uri: source.path, text: source.text, version: 1 });
      }
    };
    visit(startup);
    return compilationRecords(sources.keys(), sources);
  }
  compilationOptions(startup = this.solution?.projectPaths[0]) {
    return combinedCompilationOptions(this, startup);
  }
  buildPlan(startup = this.solution?.projectPaths[0]) {
    return createBuildPlan(this, startup);
  }
  /** Dependency-ordered selected contexts, available before lazy source contents are loaded. */
  buildContexts(startup = this.solution?.projectPaths[0]) {
    return resolveBuildContextGraph(this, startup).nodes.map(node => node.project);
  }
  /** Required resource and dependent-source paths; repeat after loading resx to discover its file references. */
  evaluationInputs() {
    const paths = new Set();
    for (const context of this.evaluationContextVariants.values()) {
      const inputs = resourceEvaluationInputs(context, { files: this.files });
      for (const path of inputs.paths) paths.add(path);
      for (const diagnostic of inputs.diagnostics) {
        if (!this.diagnostics.some(value => value.contextId === diagnostic.contextId && value.path === diagnostic.path
          && value.message === diagnostic.message)) {
          this.diagnostics.push(diagnostic);
        }
      }
    }
    return [...paths];
  }
  outputLayout(startup = this.solution?.projectPaths[0]) {
    return createOutputLayout(this.projects, startup);
  }
  runOptions(startup = this.solution?.projectPaths[0], options = {}) {
    const project = this.projects.get(startup);
    if (!project) throw new Error('Startup project was not loaded');
    return projectRunOptions(project, options);
  }
  runTargets(startup = this.solution?.projectPaths[0], targets, options = {}) {
    return runPortableTargets(this, startup, targets, options);
  }
  closure(startup) {
    const seen = new Set();
    const visit = path => {
      if (seen.has(path)) return;
      seen.add(path);
      for (const reference of this.projects.get(path)?.projectReferences ?? []) visit(reference.path);
    };
    visit(startup);
    return seen;
  }
}
