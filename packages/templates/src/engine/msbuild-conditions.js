import { TemplateError } from '../common.js';
import { evaluateTemplateExpression } from './expression.js';
import { applyValueForm } from './value-forms.js';

function symbolValue(name, values, forms) {
  const marker = '{-VALUE-FORMS-}';
  const index = name.indexOf(marker);
  if (index >= 0) {
    const source = name.slice(0, index);
    if (!Object.hasOwn(values, source)) return undefined;
    return applyValueForm(values[source], name.slice(index + marker.length), forms);
  }
  return Object.hasOwn(values, name) ? values[name] : undefined;
}

function evaluateCondition(source, values, forms) {
  let known = true;
  let references = 0;
  const replace = text => text.replace(/\$\(([^()]*)\)/g, (_token, name) => {
    references++;
    const value = symbolValue(name, values, forms);
    if (value === undefined) known = false;
    return String(value ?? '');
  });
  source = source.replace(/&quot;|&apos;|&lt;|&gt;|&amp;/g,
    entity => ({ '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' })[entity]);
  const expression = source.replace(/'[^']*'|"[^"]*"|\$\([^()]*\)/g, token => {
    const quoted = token.startsWith("'") || token.startsWith('"');
    return JSON.stringify(replace(quoted ? token.slice(1, -1) : token));
  });
  if (!known || !references) return null;
  return Boolean(evaluateTemplateExpression(expression, name => {
    throw new TemplateError('SFTPL017', 'Unsupported template MSBuild condition name: ' + name);
  }));
}

function wholeLineSpan(text, start, end) {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = text.indexOf('\n', end);
  if (/^[ \t]*$/.test(text.slice(lineStart, start)) && /^[ \t\r]*$/.test(text.slice(end, lineEnd < 0 ? text.length : lineEnd))) {
    return [lineStart, lineEnd < 0 ? text.length : lineEnd + 1];
  }
  return [start, end];
}

/** Evaluate template-owned MSBuild conditions; runtime properties such as Configuration remain unchanged. */
export function processMsbuildConditions(text, values, forms = {}) {
  const tokens = /<!--[^]*?-->|<!\[CDATA\[[^]*?\]\]>|<(?:(?:"[^"]*")|(?:'[^']*')|[^'">])*>/g;
  const stack = [];
  const edits = [];
  for (const token of text.matchAll(tokens)) {
    const tag = token[0];
    const name = /^<\s*(\/?)\s*([A-Za-z_][\w:.-]*)/.exec(tag);
    if (!name) continue;
    if (name[1]) {
      const frame = stack.pop();
      if (!frame || frame.name !== name[2]) throw new TemplateError('SFTPL017', 'Unbalanced template MSBuild element: ' + name[2]);
      if (frame.remove) {
        const [start, end] = wholeLineSpan(text, frame.start, token.index + tag.length);
        edits.push({ start, end, text: '' });
      }
      continue;
    }
    const condition = /\s+Condition\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const value = condition ? evaluateCondition(condition[1] ?? condition[2], values, forms) : null;
    const selfClosing = /\/\s*>$/.test(tag);
    if (value === false && selfClosing) {
      const [start, end] = wholeLineSpan(text, token.index, token.index + tag.length);
      edits.push({ start, end, text: '' });
    } else if (value === true) {
      edits.push({ start: token.index + condition.index, end: token.index + condition.index + condition[0].length, text: '' });
    }
    if (!selfClosing) {
      if (stack.length >= 128) throw new TemplateError('SFTPL017', 'Template MSBuild nesting limit exceeded');
      stack.push({ name: name[2], start: token.index, remove: value === false });
    }
  }
  if (stack.length) throw new TemplateError('SFTPL017', 'Unclosed template MSBuild element');
  edits.sort((left, right) => left.start - right.start || right.end - left.end);
  let position = 0;
  const output = [];
  for (const edit of edits) {
    if (edit.start < position) continue;
    output.push(text.slice(position, edit.start), edit.text);
    position = edit.end;
  }
  output.push(text.slice(position));
  return output.join('');
}
