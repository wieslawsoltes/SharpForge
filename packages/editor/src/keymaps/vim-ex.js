import { expandReplacement, findTextMatches } from '@sharpforge/text';

const supportedOptions = new Map([
  ['number', ['lineNumbers', true]], ['nonumber', ['lineNumbers', false]],
  ['wrap', ['wordWrap', true]], ['nowrap', ['wordWrap', false]],
  ['expandtab', ['insertSpaces', true]], ['noexpandtab', ['insertSpaces', false]],
  ['ignorecase', ['vimIgnoreCase', true]], ['noignorecase', ['vimIgnoreCase', false]],
  ['hlsearch', ['vimHighlightSearch', true]], ['nohlsearch', ['vimHighlightSearch', false]]
]);

function parseRange(context, input, visual) {
  const match = /^(%|(?:\d+|\.|\$|'<)(?:,(?:\d+|\.|\$|'>))?)/.exec(input);
  const current = context.position(context.selection.head).line;
  if (!match) return { first: current, last: current, command: input };
  const value = token => token === '.' ? current : token === '$' ? context.lineCount - 1
    : token === "'<" ? visual?.first ?? current : token === "'>" ? visual?.last ?? current : Number(token) - 1;
  const [left, right = left] = match[1].split(',');
  const first = match[1] === '%' ? 0 : value(left);
  const last = match[1] === '%' ? context.lineCount - 1 : value(right);
  if (first < 0 || last < first || last >= context.lineCount) throw new RangeError('Invalid Ex line range');
  return { first, last, command: input.slice(match[0].length).trim() };
}

function splitSubstitute(input) {
  const separator = input[0];
  if (!separator || /[\w\s\\]/.test(separator)) throw new Error('Substitute requires a separator, pattern and replacement');
  const parts = [];
  let value = '';
  let escaped = false;
  for (let index = 1; index < input.length; index++) {
    const character = input[index];
    if (character === separator && !escaped) {
      parts.push(value);
      value = '';
      if (parts.length === 2) return { pattern: parts[0], replacement: parts[1], flags: input.slice(index + 1) };
      continue;
    }
    if (escaped && character === separator) value = value.slice(0, -1) + character;
    else value += character;
    escaped = character === '\\' && !escaped;
  }
  if (parts.length === 1) return { pattern: parts[0], replacement: value, flags: '' };
  throw new Error('Unterminated substitute pattern');
}

/** Vim Ex commands act through the same workspace command provider as menus and keybindings. */
export class VimExCommands {
  constructor(context, state) { this.context = context; this.state = state; }
  async execute(input) {
    if (typeof input !== 'string' || input.length > 4096) throw new RangeError('Ex command exceeds 4096 characters');
    const context = this.context;
    const range = parseRange(context, input.replace(/^:/, '').trim(), this.state.visualRange);
    const match = /^(\w+|[&])(!?)(?:\s+(.*))?$/.exec(range.command);
    if (range.command.startsWith('s') && /^s[^\w\s]/.test(range.command)) return this.substitute(range);
    if (!match) {
      if (!range.command) { context.goto(context.lineStart(range.last)); return; }
      throw new Error('Invalid Ex command');
    }
    const [, command, force, args = ''] = match;
    const host = (name, parameters) => context.host(name, parameters);
    const handlers = {
      w: () => host('save'), write: () => host('save'), wa: () => host('saveAll'), wall: () => host('saveAll'),
      q: () => host('closeDocument', { force: !!force }), quit: () => host('closeDocument', { force: !!force }),
      bd: () => host('closeDocument', { force: !!force }), bdelete: () => host('closeDocument', { force: !!force }),
      wq: async () => { if (await host('save') !== false) return host('closeDocument'); },
      x: async () => { if (await host('save') !== false) return host('closeDocument'); },
      e: () => host(args ? 'openDocument' : 'reloadDocument', { path: args, force: !!force }),
      edit: () => host(args ? 'openDocument' : 'reloadDocument', { path: args, force: !!force }),
      bn: () => host('nextDocument'), bnext: () => host('nextDocument'),
      bp: () => host('previousDocument'), bprevious: () => host('previousDocument'),
      ls: () => host('listDocuments'), buffers: () => host('listDocuments'),
      split: () => host('splitHorizontal', { path: args || context.uri }),
      sp: () => host('splitHorizontal', { path: args || context.uri }),
      vsplit: () => host('splitVertical', { path: args || context.uri }),
      vs: () => host('splitVertical', { path: args || context.uri }),
      noh: () => this.clearSearch(), nohlsearch: () => this.clearSearch(),
      set: () => this.setOptions(args),
      undo: () => context.editor.undo(), redo: () => context.editor.undo(true),
      d: () => this.deleteRange(range), delete: () => this.deleteRange(range),
      y: () => this.yankRange(range), yank: () => this.yankRange(range),
      sort: () => this.sortRange(range, args),
      registers: () => context.status([...this.state.registers.values].map(([key, value]) => `"${key} ${value.text}`).join('\n'))
    };
    const handler = handlers[command];
    if (!handler) throw new Error(`Unsupported Ex command: ${command}`);
    if (args && ['w', 'write', 'wa', 'wall'].includes(command)) throw new Error('Writing to arbitrary filesystem paths needs a workspace save provider');
    return handler();
  }
  substitute({ first, last, command }) {
    const parsed = splitSubstitute(command.slice(1));
    if (/[^giIen]/.test(parsed.flags)) throw new Error('Substitute flags support g, i, I, e and n');
    const pattern = parsed.pattern || this.state.search?.pattern;
    if (!pattern) throw new Error('No previous search pattern');
    const replacement = parsed.replacement.replace(/\\([1-9])/g, (_, group) => '$' + group)
      .replace(/(^|[^\\])&/g, (_, prefix) => prefix + '$&').replace(/\\&/g, '&');
    const context = this.context;
    if (!parsed.flags.includes('n') && context.readOnly) return false;
    const matchCase = parsed.flags.includes('I') || !parsed.flags.includes('i') && !context.editor.options?.vimIgnoreCase;
    const start = context.lineStart(first);
    const end = context.lineEnd(last, true);
    const text = context.slice(start, end);
    const result = findTextMatches([{ uri: context.uri, text }], pattern, {
      regex: true, matchCase, maxMatches: 10000, multiline: true
    });
    const lines = new Set();
    const matches = result.matches.filter(match => {
      if (!parsed.flags.includes('g') && lines.has(match.line)) return false;
      lines.add(match.line);
      return true;
    });
    if (!matches.length && !parsed.flags.includes('e')) throw new Error(`Pattern not found: ${pattern}`);
    if (result.truncated) throw new RangeError('Substitute match limit exceeded; no changes applied');
    if (!parsed.flags.includes('n')) {
      const edits = matches.map(match => ({ start: start + match.start, deleteCount: match.end - match.start,
        text: expandReplacement(replacement, match, text) }));
      context.apply(edits);
    }
    this.state.search = { pattern, direction: 1, matchCase };
    context.status(`${matches.length} substitutions on ${lines.size} lines`);
    return matches.length;
  }
  clearSearch() { this.context.editor.removeDecoration?.('vim-search'); this.context.status('Search highlighting cleared'); }
  setOptions(input) {
    if (!input) { this.context.status('number nowrap tabstop=4 shiftwidth=4 expandtab'); return; }
    const changes = {};
    for (const token of input.split(/\s+/)) {
      const setting = supportedOptions.get(token);
      if (setting) changes[setting[0]] = setting[1];
      else {
        const match = /^(tabstop|ts|shiftwidth|sw)=(\d+)$/.exec(token);
        if (!match || Number(match[2]) < 1 || Number(match[2]) > 16) throw new Error(`Unsupported or invalid Vim option: ${token}`);
        changes[/^(tabstop|ts)$/.test(match[1]) ? 'tabSize' : 'indentSize'] = Number(match[2]);
      }
    }
    if (!this.context.editor.setOptions) throw new Error('Editor does not expose option updates');
    this.context.editor.setOptions(changes);
  }
  deleteRange(range) {
    this.yankRange(range, false);
    const start = this.context.lineStart(range.first);
    return this.context.apply([{ start, deleteCount: this.context.lineEnd(range.last, true) - start, text: '' }], [{ anchor: start, head: start }]);
  }
  yankRange(range, yank = true) {
    this.state.registers.write('"', this.context.slice(this.context.lineStart(range.first), this.context.lineEnd(range.last, true)),
      { linewise: true, yank });
  }
  sortRange(range, flags) {
    if (flags && flags !== 'u') throw new Error('Sort supports the u (unique) option');
    const lines = [];
    for (let line = range.first; line <= range.last; line++) lines.push(this.context.line(line));
    lines.sort();
    const text = (flags === 'u' ? [...new Set(lines)] : lines).join(this.context.eol);
    const start = this.context.lineStart(range.first);
    return this.context.apply([{ start, deleteCount: this.context.lineEnd(range.last) - start, text }]);
  }
}
