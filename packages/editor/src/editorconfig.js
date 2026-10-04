/** Parse EditorConfig sections without filesystem/network access. Callers pass files root-to-leaf. */
export function parseEditorConfig(text) {
  if (typeof text !== 'string' || text.length > 1_000_000) throw new RangeError('EditorConfig must be at most 1 MB');
  const result = {root: false, sections: []};
  let section = null;
  for (const original of text.split(/\r\n|\r|\n/)) {
    const line = original.trim();
    if (!line || /^[#;]/.test(line)) continue;
    const match = /^\[(.+)\]$/.exec(line);
    if (match) {
      section = {pattern: match[1], properties: {}};
      result.sections.push(section);
      continue;
    }
    const property = /^([^=:]+)[=:](.*)$/.exec(line);
    if (!property) throw new SyntaxError(`Invalid EditorConfig line: ${line.slice(0, 120)}`);
    const key = property[1].trim().toLowerCase();
    const value = property[2].trim().toLowerCase();
    if (section) section.properties[key] = value;
    else if (key === 'root') result.root = value === 'true';
  }
  return result;
}

export function resolveEditorConfig(path, files = [], languageOptions = {}) {
  path = path.replaceAll('\\', '/').replace(/^\//, '');
  const properties = {};
  for (const file of files) {
    const directory = (file.directory ?? '').replaceAll('\\', '/').replace(/^\//, '').replace(/\/$/, '');
    if (directory && !path.startsWith(`${directory}/`)) continue;
    const config = typeof file.text === 'string' ? parseEditorConfig(file.text) : file.config;
    if (!config) continue;
    if (config.root) for (const key of Object.keys(properties)) delete properties[key];
    const relative = directory ? path.slice(directory.length + 1) : path;
    for (const section of config.sections) {
      if (editorConfigGlob(section.pattern).test(relative)) Object.assign(properties, section.properties);
    }
  }
  const result = {...languageOptions};
  const numeric = (key, name) => {
    if (/^\d+$/.test(properties[key] ?? '')) result[name] = Math.max(1, Math.min(32, Number(properties[key])));
  };
  if (properties.indent_style === 'tab') result.insertSpaces = false;
  if (properties.indent_style === 'space') result.insertSpaces = true;
  numeric('tab_width', 'tabSize');
  numeric('indent_size', 'indentSize');
  if (properties.indent_size === 'tab') result.indentSize = result.tabSize ?? 4;
  const ending = {lf: '\n', crlf: '\r\n', cr: '\r'}[properties.end_of_line];
  if (ending) result.endOfLine = ending;
  for (const [property, option] of [['trim_trailing_whitespace', 'trimTrailingWhitespace'], ['insert_final_newline', 'insertFinalNewline']]) {
    if (['true', 'false'].includes(properties[property])) result[option] = properties[property] === 'true';
  }
  return result;
}

export function editorConfigGlob(pattern) {
  if (pattern.length > 512) throw new RangeError('EditorConfig glob is too long');
  let result = '';
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === '*') {
      const double = pattern[index + 1] === '*';
      if (double) index++;
      result += double ? '.*' : '[^/]*';
    } else if (character === '?') result += '[^/]';
    else if (character === '{') result += '(?:';
    else if (character === '}') result += ')';
    else if (character === ',') result += '|';
    else result += /[\\^$+?.()|[\]]/.test(character) ? `\\${character}` : character;
  }
  return new RegExp(`${pattern.includes('/') ? '^' : '(?:^|/)'}${result}$`);
}

/** Save normalization becomes one buffer transaction and respects the selected line-ending convention. */
export function saveTextEdits(model, options) {
  const edits = [];
  for (let line = 0; line < model.lineCount; line++) {
    const start = model.offsetAt({line, character: 0});
    const text = model.getLine(line);
    const contentEnd = start + text.length;
    const next = line + 1 < model.lineCount ? model.offsetAt({line: line + 1, character: 0}) : contentEnd;
    const trimmed = options.trimTrailingWhitespace ? text.replace(/[\t ]+$/, '') : text;
    const ending = next > contentEnd
      ? options.normalizeLineEndings === false ? model.getText(contentEnd, next) : options.endOfLine : '';
    const replacement = trimmed + ending;
    if (replacement !== model.getText(start, next)) edits.push({start, end: next, text: replacement});
  }
  if (options.insertFinalNewline && model.length && !/[\r\n]$/.test(model.getText(Math.max(0, model.length - 1)))) {
    const last = edits.at(-1);
    if (last?.end === model.length) last.text += options.endOfLine;
    else edits.push({start: model.length, end: model.length, text: options.endOfLine});
  }
  return edits;
}
