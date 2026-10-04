export const editorConfigurationLimits = Object.freeze({
  records: 20000, files: 64, charactersPerFile: 1_000_000, totalCharacters: 2_000_000, pathCharacters: 4096
});

/** Apply workspace EditorConfig ancestors over a host-selected per-language options overlay. */
export function configureDocumentEditor(editor, {records = [], languageOptions = {}, models = editor.session?.models} = {}) {
  if (editor.disposed) throw new Error('Cannot configure a disposed editor');
  const files = editorConfigFilesForDocument(editor.uri, records, {models});
  return editor.applyEditorConfig(files, languageOptions);
}

/** Read only matching ancestor configuration files; source and unrelated configuration contents stay lazy. */
export function editorConfigFilesForDocument(uri, records, {models = null} = {}) {
  const path = normalizedPath(uri);
  const source = records instanceof Map ? records.values() : records;
  if (!source?.[Symbol.iterator]) throw new TypeError('Workspace records must be iterable');
  const files = [];
  const seen = new Set();
  let count = 0;
  let characters = 0;
  for (const record of source) {
    if (++count > editorConfigurationLimits.records) throw new RangeError('EditorConfig workspace record limit exceeded');
    const uri = record?.uri ?? record?.path;
    if (typeof uri !== 'string' || !/(?:^|[\\/])\.editorconfig$/i.test(uri)) continue;
    const configPath = normalizedPath(uri);
    const separator = configPath.lastIndexOf('/');
    const directory = separator < 0 ? '' : configPath.slice(0, separator);
    if (directory && !path.startsWith(`${directory}/`)) continue;
    if (seen.has(configPath)) throw new TypeError(`Duplicate EditorConfig path '${uri}'`);
    seen.add(configPath);
    if (files.length >= editorConfigurationLimits.files) throw new RangeError('EditorConfig ancestor file limit exceeded');
    const text = configurationText(record, uri, models?.get(uri));
    characters += text.length;
    if (characters > editorConfigurationLimits.totalCharacters) throw new RangeError('EditorConfig total character limit exceeded');
    files.push({uri, directory, text});
  }
  files.sort((left, right) => left.directory.split('/').length - right.directory.split('/').length
    || left.directory.length - right.directory.length);
  return files;
}

function configurationText(record, uri, sharedModel) {
  const model = sharedModel ?? record.model;
  const maximum = editorConfigurationLimits.charactersPerFile;
  if (model && Number.isSafeInteger(model.length) && typeof model.getText === 'function') {
    if (model.length > maximum) throw new RangeError(`EditorConfig '${uri}' exceeds the character limit`);
    return model.getText(0, model.length);
  }
  const text = record.text;
  if (typeof text !== 'string') throw new TypeError(`EditorConfig '${uri}' must be a text document`);
  if (text.length > maximum) throw new RangeError(`EditorConfig '${uri}' exceeds the character limit`);
  return text;
}

function normalizedPath(value) {
  if (typeof value !== 'string' || value.length > editorConfigurationLimits.pathCharacters || value.includes('\0')) {
    throw new TypeError('Invalid EditorConfig document path');
  }
  const segments = value.replaceAll('\\', '/').split('/').filter(part => part && part !== '.');
  if (segments.some(part => part === '..')) throw new TypeError('EditorConfig paths cannot traverse parent directories');
  return segments.join('/');
}
