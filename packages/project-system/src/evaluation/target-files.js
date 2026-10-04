import {fail} from './errors.js';

/** A generated path may have different bytes in two framework contexts of the same project. */
export function buildContextFile(system, path, contextId) {
  const files = system.evaluationContextVariants.get(contextId)?.targetFiles;
  return files?.has(path) ? files.get(path) : system.files.get(path);
}

export function restoreTargetFiles(files, outputs) {
  for (const [path, record] of outputs ?? []) {
    if (record) files.set(path, {...record});
    else files.delete(path);
  }
}

/** Import only actual compiler bytes into a pending context; no output path is assumed to exist. */
export function addCompilerOutputs(context, options) {
  const outputs = options.outputs ?? [];
  if (!context.pendingBuild || !Array.isArray(outputs) || !outputs.length || outputs.length > 512) {
    fail('Post-compilation targets require a prepared context and actual compiler outputs.', 'SFP1803');
  }
  const mainPath = context.resolvePath(options.outputPath ?? context.properties.targetpath ?? '');
  if (!mainPath || !outputs.some(output => context.resolvePath(output.path) === mainPath && output.bytes?.length)) {
    fail('The prepared project assembly is missing from compiler outputs.', 'SFP1803');
  }
  let bytes = 0;
  const staged = new Map();
  for (const output of outputs) {
    const path = context.resolvePath(output.path);
    if (!path || staged.has(path) || !(output.bytes instanceof Uint8Array) || !output.bytes.length) {
      fail('Compiler outputs must have unique workspace paths and nonempty bytes.', 'SFP1803');
    }
    bytes += output.bytes.length;
    if (bytes > (options.maxArtifactBytes ?? 128 * 1024 * 1024)) fail('Compiler artifact byte limit exceeded.', 'MSB0001');
    staged.set(path, {path, bytes: output.bytes.slice(), virtual: true, buildArtifact: true});
  }
  for (const [path, record] of staged) {
    context.files.set(path, record);
    context.pathIndex.add(path);
    context.targetFiles.set(path, record);
  }
}

export function captureTargetFiles(context, changed) {
  for (const path of changed) {
    const file = context.files.get(path);
    context.targetFiles.set(path, file ? {...file, ...(file.bytes ? {bytes: file.bytes.slice()} : {})} : null);
  }
}
