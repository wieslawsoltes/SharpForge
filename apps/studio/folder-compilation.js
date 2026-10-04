const MAX_FILES = 20000;
const MAX_SOURCE_LENGTH = 2_000_000;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const pathOf = file => file.path ?? file.uri;
const isSource = file => /\.cs$/i.test(pathOf(file) ?? '');

function sourceRecords(state) {
  const records = state.extraFiles ?? state.disk?.records ?? [];
  const sources = new Map(records.filter(isSource).map(record => [pathOf(record), record]));
  for (const buffer of state.files) if (isSource(buffer)) sources.set(pathOf(buffer), buffer);
  if (sources.size > MAX_FILES) throw new RangeError('Folder compilation source-count limit exceeded');
  return sources;
}

function sourceFile(record, path) {
  if (typeof record?.text !== 'string') throw new Error('Folder compilation requires source text: ' + path);
  if (record.text.length > MAX_SOURCE_LENGTH) throw new RangeError('A C# source exceeds the 2 MB editor limit: ' + path);
  return {...record, path, uri: path, version: record.version ?? 1};
}

/** Folder mode includes closed sources in the workspace membership, without creating editor buffers. */
export function folderCompilationFiles(state) {
  let bytes = 0;
  return [...sourceRecords(state)].map(([path, record]) => {
    const file = sourceFile(record, path);
    bytes += file.text.length * 2;
    if (bytes > MAX_SOURCE_BYTES) throw new RangeError('Folder compilation exceeds the 64 MiB source budget');
    return file;
  });
}

/** Materialize only C# inputs; cancellation or workspace replacement never publishes a partial source set. */
export async function hydrateFolderSources(state, {signal} = {}) {
  const {disk, revision, workspaceEpoch, projectSystem} = state;
  const assertCurrent = () => {
    signal?.throwIfAborted();
    if (state.disk !== disk || state.revision !== revision || state.workspaceEpoch !== workspaceEpoch
      || state.projectSystem !== projectSystem) throw new Error('Workspace changed while preparing folder compilation; retry the build');
  };
  assertCurrent();
  const sources = sourceRecords(state);
  const loaded = new Map();
  let bytes = 0;
  let count = 0;
  for (const [path, input] of sources) {
    assertCurrent();
    let record = input;
    if (record.lazy && typeof record.text !== 'string') {
      if (!disk?.load) throw new Error('Original source bytes are unavailable: ' + path);
      record = await disk.load(path, {signal});
      assertCurrent();
      loaded.set(path, record);
    }
    const file = sourceFile(record, path);
    bytes += file.text.length * 2;
    if (bytes > MAX_SOURCE_BYTES) throw new RangeError('Folder compilation exceeds the 64 MiB source budget');
    if (++count % 64 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  assertCurrent();
  const records = state.extraFiles ?? disk?.records;
  if (records && loaded.size) state.extraFiles = records.map(record => loaded.get(pathOf(record)) ?? record);
}
