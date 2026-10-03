import {DesignerAppHostError, assertAppSignal, awaitAppOperation} from './designer-app-host-errors.js';

const profiles = Object.freeze(['cil', 'source-vm', 'managed-il']);

/** Copy a bounded source projection. Text is immutable and URI identity remains case sensitive. */
export function captureAppSources(files) {
  if (!Array.isArray(files) || files.length > 1000) throw new DesignerAppHostError('App source file limit exceeded', 'SFDA0007');
  let length = 0;
  const seen = new Set();
  const sources = files.map(file => {
    if (typeof file?.uri !== 'string' || !file.uri || file.uri.length > 4096 || file.uri.includes('\0') || seen.has(file.uri)) {
      throw new DesignerAppHostError('App sources require unique bounded URIs', 'SFDA0007');
    }
    if (typeof file.text !== 'string' || file.text.length > 2_000_000 || (length += file.text.length) > 16_000_000) {
      throw new DesignerAppHostError('App source text limit exceeded', 'SFDA0007');
    }
    seen.add(file.uri);
    return Object.freeze({uri: file.uri, text: file.text, version: Number.isSafeInteger(file.version) ? file.version : 0});
  });
  sources.sort((left, right) => left.uri < right.uri ? -1 : left.uri > right.uri ? 1 : 0);
  return Object.freeze(sources);
}

export function sameAppSources(left, right) {
  return left.length === right.length && left.every((file, index) => file.uri === right[index].uri && file.text === right[index].text);
}

/** Pin actual compilation inputs; a workspace projection alone never establishes editable project membership. */
export function captureAppCompilationUris(uris, sourceProjection) {
  if (uris === undefined || uris === null || Array.isArray(uris) && !uris.length) return null;
  if (!Array.isArray(uris) || uris.length > 1000) {
    throw new DesignerAppHostError('App compilation inputs require a bounded URI list', 'SFDA0012');
  }
  const available = new Set(sourceProjection.map(file => file.uri));
  const included = new Set();
  for (const uri of uris) {
    if (typeof uri !== 'string' || !uri || uri.length > 4096 || uri.includes('\0') || included.has(uri) || !available.has(uri)) {
      throw new DesignerAppHostError('App compilation inputs must identify unique workspace sources', 'SFDA0012');
    }
    included.add(uri);
  }
  return Object.freeze([...included].sort());
}

function sameCompilationUris(left, right) {
  return !!left && !!right && left.length === right.length && left.every((uri, index) => uri === right[index]);
}

export function appWorkspaceIdentity(value) {
  if (!['string', 'number'].includes(typeof value) || !String(value) || String(value).length > 4096 ||
      typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new DesignerAppHostError('A stable workspace identity is required to run another app', 'SFDA0008');
  }
  return value;
}

export function appProfile(value = 'cil') {
  if (!profiles.includes(value)) throw new DesignerAppHostError('Unsupported app execution profile', 'SFDA0009');
  return value;
}

/** Validate the selected engine's executable; assembly loading remains in the runtime worker. */
export function appLaunchParameters(result, {profile, debug, sourceProjection, runtimeOptions = {}}) {
  if (!result?.success) throw new DesignerAppHostError('App compilation failed', 'SFDA0010', {diagnostics: result?.diagnostics ?? []});
  if (profile === 'source-vm' ? !result.image : !(result.assembly instanceof Uint8Array) || !result.assembly.length) {
    throw new DesignerAppHostError('App compilation produced no executable for the selected profile', 'SFDA0010');
  }
  const executable = profile === 'source-vm' ? {image: result.image} : {assembly: result.assembly};
  const permitted = ['network', 'compute', 'recordHistory', 'maxHistory', 'maxHistoryBytes', 'maxInstructions', 'stepOverProperties',
    'breakpointsEnabled', 'breakpoints', 'functionBreakpoints', 'exceptionBreak', 'exceptionRules', 'instructionBreakpoints',
    'methodToken', 'arguments', 'manualAnimations'];
  const runtime = Object.fromEntries(permitted.filter(key => Object.hasOwn(runtimeOptions, key)).map(key => [key, runtimeOptions[key]]));
  return {
    ...runtime, ...executable, debug, managedIL: profile === 'managed-il', stopOnEntry: false,
    pdb: result.pdb ?? null, sources: Object.fromEntries(sourceProjection.map(file => [file.uri, file.text]))
  };
}

/** Source edits need a receipt tied to this app, workspace and complete before/after projection. */
export class DesignerAppSourceOwnership {
  constructor({workspaceId, sourceProjection, compilationUris, getWorkspaceId, sourceFiles, compile, options, assertCurrent}) {
    Object.assign(this, {workspaceId, getWorkspaceId, sourceFiles, compileBuild: compile, options, assertCurrent});
    this.projection = sourceProjection;
    this.compilationUris = captureAppCompilationUris(compilationUris, sourceProjection);
    this.compilationUriSet = new Set(this.compilationUris);
    this.authorized = null;
    this.compiled = null;
    this.busy = false;
    this.uncertain = false;
    this.disposed = false;
    this.activeCompile = null;
  }

  current() {
    if (this.disposed) throw new DesignerAppHostError('App source ownership was disposed', 'SFDA0002');
    this.assertCurrent();
    if (this.getWorkspaceId() !== this.workspaceId) {
      throw new DesignerAppHostError('This app belongs to another workspace. Its sources were not changed.', 'SFDA0008');
    }
    return captureAppSources(this.sourceFiles());
  }

  assertSourceOwnership({uris = []} = {}) {
    if (this.uncertain) throw new DesignerAppHostError('Restart this app after the interrupted code update', 'SFDA0011');
    const expected = this.authorized ?? this.projection;
    if (!sameAppSources(expected, this.current())) {
      throw new DesignerAppHostError('Workspace sources no longer match this app. Restart it before editing its source.', 'SFDA0012');
    }
    this.assertCompilationInputs(expected);
    if (!Array.isArray(uris) || uris.some(uri => !this.compilationUriSet.has(uri))) {
      throw new DesignerAppHostError('The source edit targets a document outside this app', 'SFDA0012');
    }
    return expected;
  }

  assertCompilationInputs(projection) {
    if (!this.compilationUris) {
      throw new DesignerAppHostError('Restart this app with explicit compilation inputs before editing its source', 'SFDA0012');
    }
    captureAppCompilationUris(this.compilationUris, projection);
  }

  assertChangedUris(previous, next) {
    const before = new Map(previous.map(file => [file.uri, file.text]));
    const after = new Map(next.map(file => [file.uri, file.text]));
    for (const uri of new Set([...before.keys(), ...after.keys()])) {
      if (before.get(uri) !== after.get(uri) && !this.compilationUriSet.has(uri)) {
        throw new DesignerAppHostError('The source receipt changes a file outside this app compilation', 'SFDA0012');
      }
    }
  }

  authorizeSourceChanges({before, after}) {
    if (this.busy) throw new DesignerAppHostError('App compilation is already pending', 'SFDA0013');
    const previous = captureAppSources(before);
    const next = captureAppSources(after);
    if (this.uncertain || !sameAppSources(previous, this.authorized ?? this.projection) || !sameAppSources(next, this.current())) {
      throw new DesignerAppHostError('Source changes do not belong to this app projection', 'SFDA0012');
    }
    this.assertCompilationInputs(next);
    this.assertChangedUris(previous, next);
    this.authorized = next;
    this.compiled = null;
    return next;
  }

  async compile({signal} = {}) {
    assertAppSignal(signal);
    if (this.busy) throw new DesignerAppHostError('App compilation is already pending', 'SFDA0013');
    const projection = this.assertSourceOwnership();
    const controller = new AbortController();
    const canceled = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', canceled, {once: true});
    if (signal?.aborted) canceled();
    this.activeCompile = controller;
    this.busy = true;
    this.compiled = null;
    try {
      const result = await awaitAppOperation(() => this.compileBuild({
        ...this.options, reason: 'designer-app-hot-reload', sourceProjection: projection, files: projection, signal: controller.signal
      }), {signal: controller.signal});
      assertAppSignal(signal);
      if (!sameAppSources(projection, this.current())) {
        throw new DesignerAppHostError('Sources changed during app compilation; the result was discarded', 'SFDA0012');
      }
      if (result?.success) {
        const compilationUris = captureAppCompilationUris(result.compilationUris, projection);
        if (!sameCompilationUris(this.compilationUris, compilationUris)) {
          throw new DesignerAppHostError('App compilation inputs changed; restart this app before updating its code', 'SFDA0012');
        }
        this.compiled = {result, projection, compilationUris};
      }
      return result;
    } finally {
      this.busy = false;
      signal?.removeEventListener('abort', canceled);
      this.activeCompile = null;
      controller.abort();
    }
  }

  assertCodeUpdate(parameters) {
    this.assertSourceOwnership();
    const compiled = this.compiled;
    const field = this.options.profile === 'managed-il' ? 'assembly' : 'image';
    if (!compiled?.result?.[field] || parameters[field] !== compiled.result[field] ||
        !sameAppSources(compiled.projection, this.current()) || !sameCompilationUris(this.compilationUris, compiled.compilationUris)) {
      throw new DesignerAppHostError('Compile this app source projection before applying code', 'SFDA0012');
    }
    return compiled;
  }

  acceptCodeUpdate(compiled) {
    this.projection = compiled.projection;
    this.authorized = null;
    this.compiled = null;
  }

  dispose() {
    this.disposed = true;
    this.activeCompile?.abort(new DesignerAppHostError('App source compilation was stopped', 'SFDA0002'));
    this.compiled = null;
    this.authorized = null;
  }
}
