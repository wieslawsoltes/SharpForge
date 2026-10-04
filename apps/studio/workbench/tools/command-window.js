import {commandAliases} from '../commands.js';
import {button, element, input, runAction} from '../ui.js';

/** Parses quoted arguments as strings and routes only registered commands; never evaluates code. */
export function parseCommandLine(text) {
  if (typeof text !== 'string' || text.length > 8192) throw new RangeError('Command line must be at most 8192 characters');
  const tokens = [];
  let value = '', quote = null, escaped = false, active = false;
  for (const character of text.trim().replace(/^>\s*/u, '')) {
    if (escaped) { value += character; escaped = false; active = true; continue; }
    if (character === '\\' && quote) { escaped = true; continue; }
    if (quote) { if (character === quote) quote = null; else value += character; active = true; continue; }
    if (character === '"' || character === "'") { quote = character; active = true; continue; }
    if (/\s/u.test(character)) { if (active) { tokens.push(value); value = ''; active = false; } }
    else { value += character; active = true; }
  }
  if (quote || escaped) throw new SyntaxError('Unclosed command argument');
  if (active) tokens.push(value);
  if (!tokens.length) throw new Error('Enter a command');
  return {name: tokens[0], args: tokens.slice(1)};
}

export class CommandWindow {
  constructor({registry, aliases = commandAliases, limit = 200}) {
    this.registry = registry;
    this.aliases = new Map(Object.entries(aliases));
    this.history = [];
    this.transcript = [];
    this.limit = limit;
  }
  complete(query) {
    const lower = query.toLowerCase();
    return [...this.aliases.keys(), ...this.registry.search().map(command => command.id)]
      .filter(name => name.toLowerCase().startsWith(lower)).slice(0, 100);
  }
  async execute(text, {signal} = {}) {
    const parsed = parseCommandLine(text);
    const command = this.aliases.get(parsed.name) ?? parsed.name;
    if (!this.registry.describe(command)) throw new Error('Unknown command: ' + parsed.name);
    this.history.push(text); if (this.history.length > this.limit) this.history.shift();
    this.transcript.push('> ' + text);
    try {
      const result = await this.registry.invoke(command, {args: parsed.args, signal});
      if (result !== undefined && result !== null && typeof result !== 'object') this.transcript.push(String(result));
      return result;
    } catch (error) { this.transcript.push('Error: ' + error.message); throw error; }
    finally { if (this.transcript.length > this.limit * 2) this.transcript.splice(0, this.transcript.length - this.limit * 2); }
  }
}

export function mountCommandWindow(host, {model, onError}) {
  const document = host.ownerDocument;
  let historyIndex = model.history.length;
  const transcript = element(document, 'pre', {className: 'wb-command-transcript', role: 'log', 'aria-label': 'Command history'});
  const completions = element(document, 'div', {className: 'wb-command-completions'});
  const command = input(document, 'Command', '', value => {
    completions.replaceChildren(...model.complete(value).map(name => button(document, name, () => { command.value = name; command.focus(); })));
  }, {placeholder: '> Debug.Start'});
  const refresh = () => { transcript.textContent = model.transcript.join('\n'); transcript.scrollTop = transcript.scrollHeight; };
  const run = runAction(async () => {
    const text = command.value;
    command.value = '';
    try { await model.execute(text); } finally { refresh(); historyIndex = model.history.length; }
  }, onError);
  command.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); run(); }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      historyIndex = Math.max(0, Math.min(model.history.length, historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
      command.value = model.history[historyIndex] ?? '';
    }
    if (event.key === 'Tab') {
      const candidate = model.complete(command.value)[0];
      if (candidate) { event.preventDefault(); command.value = candidate; }
    }
  });
  host.replaceChildren(transcript, command, completions, button(document, 'Execute', run));
  refresh();
  return {refresh, dispose() {}};
}
