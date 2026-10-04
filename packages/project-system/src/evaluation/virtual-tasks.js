import { baseName } from '../paths.js';
import { splitList, toBoolean, fail } from './errors.js';
import { evaluatePropertyGroup } from './properties.js';
import { evaluateItemGroup } from './items.js';

function attribute(context, node, name, fallback = '') {
  return context.expand(node.attributes[name] ?? fallback);
}

function paths(context, node, name) {
  return splitList(context.expand(node.attributes[name] ?? '', { decode: false })).map(value => context.resolvePath(value));
}

function requireFile(context, path) {
  const file = context.files.get(path);
  if (!file) fail(`Task source file '${path}' is missing.`, 'MSB3030');
  if (file.lazy || typeof file.text !== 'string' && !(file.bytes instanceof Uint8Array)) {
    fail(`Task source file '${path}' must be hydrated before execution.`, 'MSB3030', { requiredFiles: [path] });
  }
  return file;
}

function write(context, path, value, runner) {
  if (!path) fail('Task destination must be a file path.', 'MSB3021');
  const bytes = value.bytes?.length ?? new TextEncoder().encode(value.text ?? '').length;
  runner.outputBytes += bytes;
  if (runner.outputBytes > runner.maxOutputBytes) fail('Portable target output-byte limit exceeded.', 'MSB0001');
  context.files.set(path, { ...value, path, virtual: true, modified: runner.logicalTime });
  context.pathIndex.add(path);
  runner.changed.add(path);
}

export const virtualTaskHandlers = {
  Message(context, node, runner) {
    runner.messages.push({ level: 'message', text: attribute(context, node, 'Text'), importance: attribute(context, node, 'Importance', 'normal') });
    return {};
  },
  Warning(context, node, runner) {
    const text = attribute(context, node, 'Text');
    const code = attribute(context, node, 'Code', 'MSB9000');
    runner.messages.push({ level: 'warning', code, text });
    context.diagnostic(text, node, code, 'warning');
    return {};
  },
  Error(context, node) { fail(attribute(context, node, 'Text', 'Error task failed.'), attribute(context, node, 'Code', 'MSB9001')); },
  PropertyGroup(context, node) { evaluatePropertyGroup(context, node, true); return {}; },
  ItemGroup(context, node) { evaluateItemGroup(context, node, true); return {}; },
  WriteLinesToFile(context, node, runner) {
    const file = context.resolvePath(attribute(context, node, 'File'));
    const lines = splitList(context.expand(node.attributes.Lines, { decode: false }));
    const encoding = attribute(context, node, 'Encoding', 'UTF-8').toLowerCase();
    if (!['utf-8', 'utf8', 'unicode', 'utf-16'].includes(encoding)) fail(`Encoding '${encoding}' is unsupported.`, 'MSB3090');
    const overwrite = toBoolean(attribute(context, node, 'Overwrite', 'false'));
    const existing = !overwrite && context.files.has(file) ? requireFile(context, file) : null;
    const previous = existing ? existing.text ?? new TextDecoder(encoding, { fatal: true }).decode(existing.bytes) : '';
    const text = previous + (lines.length ? lines.join(context.newline) + context.newline : '');
    if (toBoolean(attribute(context, node, 'WriteOnlyWhenDifferent', 'false')) && context.files.get(file)?.text === text) return {};
    const record = { text };
    if (encoding === 'unicode' || encoding === 'utf-16') {
      record.bytes = new Uint8Array(2 + text.length * 2);
      const view = new DataView(record.bytes.buffer);
      view.setUint16(0, 0xfeff, true);
      for (let index = 0; index < text.length; index++) view.setUint16(2 + index * 2, text.charCodeAt(index), true);
    }
    write(context, file, record, runner);
    return {};
  },
  ReadLinesFromFile(context, node) {
    const file = requireFile(context, context.resolvePath(attribute(context, node, 'File')));
    const text = file.text ?? new TextDecoder('utf-8', { fatal: true }).decode(file.bytes);
    return { Lines: text.split(/\r?\n/).filter(Boolean) };
  },
  Copy(context, node, runner) {
    const sources = paths(context, node, 'SourceFiles');
    const destinations = paths(context, node, 'DestinationFiles');
    const folder = attribute(context, node, 'DestinationFolder');
    if (folder && destinations.length || !folder && destinations.length !== sources.length) {
      fail('Copy requires matching destination files or a folder.', 'MSB3094');
    }
    const requiredFiles = sources.filter(path => context.files.get(path)?.lazy);
    if (requiredFiles.length) fail(`${requiredFiles.length} Copy source file(s) must be hydrated before execution.`, 'MSB3030', { requiredFiles });
    const copied = [];
    for (let index = 0; index < sources.length; index++) {
      context.step();
      const file = requireFile(context, sources[index]);
      const destination = folder ? context.resolvePath(folder + '/' + baseName(sources[index])) : destinations[index];
      const current = context.files.get(destination);
      const same = current && current.text === file.text && (current.bytes === file.bytes || current.bytes && file.bytes
        && current.bytes.length === file.bytes.length && current.bytes.every((value, index) => value === file.bytes[index]));
      if (!toBoolean(attribute(context, node, 'SkipUnchangedFiles', 'false')) || !same) write(context, destination, {
        ...file, ...(file.bytes ? { bytes: file.bytes.slice() } : {}),
      }, runner);
      copied.push(destination);
    }
    return { CopiedFiles: copied, DestinationFiles: copied };
  },
  MakeDir(context, node, runner) {
    const directories = paths(context, node, 'Directories');
    for (const directory of directories) {
      runner.directories.add(directory);
      context.pathIndex.addDirectory(directory);
    }
    return { DirectoriesCreated: directories };
  },
  Touch(context, node, runner) {
    const files = paths(context, node, 'Files');
    for (const path of files) {
      if (!context.files.has(path) && !toBoolean(attribute(context, node, 'AlwaysCreate', 'false'))) continue;
      write(context, path, context.files.get(path) ?? { text: '' }, runner);
    }
    return { TouchedFiles: files.filter(path => context.files.has(path)) };
  },
  Delete(context, node, runner) {
    const files = paths(context, node, 'Files');
    const deleted = [];
    for (const path of files) {
      if (!context.files.delete(path)) continue;
      context.pathIndex.remove(path);
      runner.changed.add(path);
      deleted.push(path);
    }
    return { DeletedFiles: deleted };
  },
  RemoveDir(context, node, runner) {
    const directories = paths(context, node, 'Directories');
    for (const directory of directories) {
      if (!directory) fail('Cannot remove the virtual workspace root.', 'MSB0001');
      for (const path of context.pathIndex.glob(directory + '/**')) {
        context.step();
        context.files.delete(path);
        context.pathIndex.remove(path);
        runner.changed.add(path);
      }
      runner.directories.delete(directory);
      context.pathIndex.removeDirectory(directory);
    }
    return { RemovedDirectories: directories };
  },
  CallTarget(context, node, runner) {
    const names = splitList(attribute(context, node, 'Targets'));
    for (const name of names) runner.callTarget(name);
    return { TargetOutputs: [] };
  },
};
