import { normalizePath, directoryName } from '../paths.js';
import { evaluateCondition } from '../conditions.js';
import { expandExpression } from './expander.js';
import { EvaluationError } from './errors.js';
import { initializeProperties, fileProperties } from './reserved-properties.js';
import { WorkspacePathIndex } from './path-index.js';

/** Explicit state shared by property, definition, item and target phases of a single project. */
export class EvaluationContext {
  constructor(system, path, root) {
    const options = system.options ?? {};
    this.system = system;
    this.path = path;
    this.base = directoryName(path);
    this.currentFile = path;
    this.currentItem = null;
    this.properties = Object.create(null);
    this.items = Object.create(null);
    this.definitions = Object.create(null);
    this.globals = new Set();
    this.files = system.files;
    this.pathIndex = system.pathIndex ?? new WorkspacePathIndex(this.files.keys(), options);
    this.environment = { ...options.environment };
    this.osPlatform = options.osPlatform ?? 'linux';
    this.clock = options.clock;
    this.guid = options.guid;
    this.newline = options.newline ?? '\n';
    this.featureWave = options.featureWave ?? '17.0';
    this.signal = options.signal;
    this.limits = { expressionLength: 65536, expressionDepth: 64, imports: 256, importDepth: 64, items: 100000, steps: 1000000, ...options.limits };
    this.steps = 0;
    this.imports = [];
    this.importRecords = [];
    this.sdkImports = [];
    this.itemGroups = [];
    this.definitionGroups = [];
    this.targets = [];
    this.usingTasks = [];
    this.targetAttributes = {};
    this.visited = new Set();
    this.sdkModels = [];
    this.generatedSources = [];
    this.expand = (value, options) => expandExpression(value, this, options);
    this.exists = value => {
      try { return this.pathIndex.exists(this.resolvePath(value)); }
      catch (error) {
        if (error instanceof EvaluationError && error.code === 'MSB0001') throw error;
        return false;
      }
    };
    initializeProperties(this, system, root);
  }

  step() {
    if (this.signal?.aborted) throw new EvaluationError('Project evaluation cancelled.', 'SFP1099');
    if (++this.steps > this.limits.steps) throw new EvaluationError('Evaluation step limit exceeded.', 'MSB0001');
  }

  resolvePath(value, base = this.base) {
    value = String(value).replaceAll('\\', '/');
    if (/[\u0000-\u001f]/.test(value) || /^(?:[A-Za-z]:|[a-z][a-z\d+.-]*:)/i.test(value)) {
      throw new EvaluationError('Path is outside the granted virtual workspace.', 'MSB0001');
    }
    const absolute = value.startsWith('/');
    const parts = (absolute ? [] : String(base).split('/').filter(Boolean));
    for (const part of value.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!parts.length) throw new EvaluationError('Path escapes the granted workspace.', 'MSB0001');
        parts.pop();
      } else parts.push(part);
    }
    return parts.length ? normalizePath(parts.join('/')) : '';
  }

  withFile(file, action) {
    const saved = this.currentFile;
    const previous = fileProperties(saved);
    this.currentFile = file;
    Object.assign(this.properties, fileProperties(file));
    try { return action(); }
    finally { this.currentFile = saved; Object.assign(this.properties, previous); }
  }

  withItem(item, action) {
    const previous = this.currentItem;
    this.currentItem = item;
    try { return action(); }
    finally { this.currentItem = previous; }
  }

  diagnostic(error, node, code, severity = 'error') {
    const message = typeof error === 'string' ? error : error.message;
    const result = this.system.diagnostic(this.path, message, severity, code ?? error.code ?? 'SFP1001');
    result.file = this.currentFile;
    result.start = error.start ?? node?.start ?? 0;
    result.length = error.length ?? Math.max(0, (node?.end ?? node?.start ?? 0) - (node?.start ?? 0));
    if (Array.isArray(error.requiredFiles)) result.requiredFiles = [...error.requiredFiles];
    return result;
  }

  enabled(node) {
    this.step();
    try { return evaluateCondition(node.attributes?.Condition, { context: this }); }
    catch (error) { this.diagnostic(error, node, 'SFP1003'); return false; }
  }
}
