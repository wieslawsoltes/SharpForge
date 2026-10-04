/** Parses bounded TextMate-style placeholders, mirrors, choices and variables without evaluating expressions. */
export function parseSnippet(template, options = {}) {
  if (typeof template !== 'string' || template.length > (options.maxLength ?? 100_000)) throw new RangeError('Snippet is too large');
  const state = {text: template, index: 0, nodes: 0, maxNodes: options.maxNodes ?? 4096};
  const nodes = parseSequence(state, false, 0);
  if (state.index !== template.length) throw new SyntaxError('Unexpected snippet terminator');
  return nodes;
}

function parseSequence(state, nested, depth) {
  if (depth > 16) throw new RangeError('Snippet nesting exceeds 16 levels');
  const nodes = [];
  let text = '';
  const flush = () => { if (text) nodes.push({kind: 'text', text}); text = ''; };
  while (state.index < state.text.length) {
    const character = state.text[state.index++];
    if (character === '}' && nested) { flush(); return nodes; }
    if (character === '\\' && state.index < state.text.length && /[$}\\,|]/.test(state.text[state.index])) {
      text += state.text[state.index++];
      continue;
    }
    if (character !== '$') { text += character; continue; }
    const match = /^(\d+|[A-Za-z_][A-Za-z_0-9]*)/.exec(state.text.slice(state.index));
    if (match) {
      flush();
      state.index += match[0].length;
      nodes.push(reference(match[0]));
    } else if (state.text[state.index] === '{') {
      flush();
      state.index++;
      nodes.push(parseBraced(state, depth));
    } else text += '$';
    if (++state.nodes > state.maxNodes) throw new RangeError('Snippet node budget exceeded');
  }
  if (nested) throw new SyntaxError('Unterminated snippet placeholder');
  flush();
  return nodes;
}

function reference(name) {
  if (/^\d+$/.test(name)) {
    const index = Number(name);
    if (!Number.isSafeInteger(index)) throw new RangeError('Invalid snippet tab stop');
    return {kind: 'placeholder', index};
  }
  return {kind: 'variable', name};
}

function parseBraced(state, depth) {
  const match = /^(\d+|[A-Za-z_][A-Za-z_0-9]*)/.exec(state.text.slice(state.index));
  if (!match) throw new SyntaxError(`Invalid snippet placeholder at ${state.index}`);
  state.index += match[0].length;
  const result = reference(match[0]);
  const delimiter = state.text[state.index++];
  if (delimiter === '}') return result;
  if (delimiter === ':') return {...result, children: parseSequence(state, true, depth + 1)};
  if (delimiter === '|' && result.kind === 'placeholder') return {...result, choices: parseChoices(state)};
  throw new SyntaxError('Snippet transforms are not supported; use placeholders, choices or variables');
}

function parseChoices(state) {
  const choices = [];
  let text = '';
  while (state.index < state.text.length) {
    const character = state.text[state.index++];
    if (character === '\\' && /[,|\\]/.test(state.text[state.index] ?? '')) text += state.text[state.index++];
    else if (character === ',') { choices.push(text); text = ''; }
    else if (character === '|' && state.text[state.index] === '}') {
      state.index++;
      choices.push(text);
      return choices;
    } else text += character;
  }
  throw new SyntaxError('Unterminated snippet choices');
}

/** Expands UTF-16 placeholders; an optional formatVariable callback receives {name, value, prefix} and must return text. */
export function expandSnippet(template, variables = {}, {formatVariable} = {}) {
  const nodes = Array.isArray(template) ? template : parseSnippet(template);
  const defaults = new Map();
  collectDefaults(nodes, defaults);
  const output = {text: '', stops: new Map()};
  renderNodes(nodes, {variables, defaults, formatVariable, values: new Map(), resolving: new Set()}, output);
  if (!output.stops.has(0)) output.stops.set(0, [{start: output.text.length, end: output.text.length, choices: []}]);
  return {text: output.text, stops: output.stops, order: [...output.stops.keys()].filter(index => index !== 0).sort((a, b) => a - b).concat(0)};
}

function collectDefaults(nodes, defaults) {
  for (const node of nodes) {
    if (node.kind === 'placeholder' && (node.children || node.choices) && !defaults.has(node.index)) defaults.set(node.index, node);
    if (node.children) collectDefaults(node.children, defaults);
  }
}

function renderNodes(nodes, context, output) {
  for (const node of nodes) {
    if (node.kind === 'text') { output.text += node.text; continue; }
    if (node.kind === 'variable') {
      if (context.variables[node.name] !== undefined) {
        const value = String(context.variables[node.name]);
        const formatted = context.formatVariable ? context.formatVariable({name: node.name, value, prefix: output.text}) : value;
        if (typeof formatted !== 'string') throw new TypeError('Snippet variable formatter must return text');
        output.text += formatted;
      } else if (node.children) renderNodes(node.children, context, output);
      continue;
    }
    const start = output.text.length;
    const definition = context.defaults.get(node.index) ?? node;
    if (context.values.has(node.index)) output.text += context.values.get(node.index);
    else {
      if (context.resolving.has(node.index)) throw new SyntaxError('Recursive snippet placeholder');
      context.resolving.add(node.index);
      if (definition.choices) output.text += definition.choices[0] ?? '';
      else if (definition.children) renderNodes(definition.children, context, output);
      context.values.set(node.index, output.text.slice(start));
      context.resolving.delete(node.index);
    }
    const ranges = output.stops.get(node.index) ?? [];
    ranges.push({start, end: output.text.length, choices: definition.choices ?? []});
    output.stops.set(node.index, ranges);
  }
}
