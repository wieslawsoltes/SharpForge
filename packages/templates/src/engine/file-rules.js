import { portablePath } from '@sharpforge/archive';
import { TemplateError } from '../common.js';
import { evaluateTemplateExpression } from './expression.js';

export function conditionValue(condition, values) {
  if (condition === undefined || condition === '') return true;
  if (typeof condition === 'boolean') return condition;
  return Boolean(evaluateTemplateExpression(condition, name => {
    if (!Object.hasOwn(values, name)) throw new TemplateError('SFTPL013', 'Unknown conditional symbol: ' + name);
    return values[name];
  }));
}

export function globMatcher(pattern) {
  if (typeof pattern !== 'string' || pattern.length > 1024) throw new TemplateError('SFTPL016', 'Invalid template glob');
  pattern = pattern.replaceAll('\\', '/').replace(/^\.\//, '');
  let expression = '^';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      index++;
      if (pattern[index + 1] === '/') { expression += '(?:.*/)?'; index++; }
      else expression += '.*';
    } else if (char === '*') expression += '[^/]*';
    else if (char === '?') expression += '[^/]';
    else if (char === '[') {
      const end = pattern.indexOf(']', index + 1);
      const content = pattern.slice(index + 1, end);
      if (end < 0 || !/^[!A-Za-z0-9_-]+$/.test(content)) throw new TemplateError('SFTPL016', 'Unsupported template glob class');
      expression += '[' + content.replace(/^!/, '^') + ']';
      index = end;
    } else expression += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(expression + '$');
}

function patterns(value, fallback = []) {
  if (value === undefined) return fallback;
  const result = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(result) || result.length > 1024 || result.some(item => typeof item !== 'string')) {
    throw new TemplateError('SFTPL016', 'Invalid template file rules');
  }
  return [...result];
}

export function sourcePrefix(value = './') {
  const path = value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  return path ? portablePath(path) + '/' : '';
}

export function compileSourceRules(source, values) {
  const include = patterns(source.include, ['**/*']);
  const exclude = patterns(source.exclude, ['**/[Bb]in/**', '**/[Oo]bj/**', '**/.template.config/**']);
  const copyOnly = patterns(source.copyOnly);
  const rename = { ...(source.rename ?? {}) };
  for (const modifier of source.modifiers ?? []) {
    if (!conditionValue(modifier.condition, values)) continue;
    include.push(...patterns(modifier.include));
    exclude.push(...patterns(modifier.exclude));
    copyOnly.push(...patterns(modifier.copyOnly));
    Object.assign(rename, modifier.rename ?? {});
  }
  return {
    source: sourcePrefix(source.source), target: sourcePrefix(source.target), rename,
    include: include.map(globMatcher), exclude: exclude.map(globMatcher), copyOnly: copyOnly.map(globMatcher)
  };
}

/** Process line-based C#, JSON and XML conditional comments with exact retained line endings. */
export function processTemplateConditionals(text, values) {
  const stack = [];
  let active = true;
  const output = [];
  for (const line of text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? []) {
    let directive = line.trim();
    if (directive.startsWith('//')) directive = directive.slice(2).trim();
    if (directive.startsWith('<!--') && directive.endsWith('-->')) directive = directive.slice(4, -3).trim();
    if (directive.startsWith('/*') && directive.endsWith('*/')) directive = directive.slice(2, -2).trim();
    const match = /^#(if|elseif|elif|else|endif)\b\s*(.*?)\s*$/.exec(directive);
    if (!match) { if (active) output.push(line); continue; }
    const [, command, expression] = match;
    if (command === 'if') {
      if (stack.length >= 64) throw new TemplateError('SFTPL017', 'Template conditional nesting limit exceeded');
      const condition = conditionValue(expression, values);
      stack.push({ parent: active, taken: condition, hasElse: false });
      active = active && condition;
      continue;
    }
    const frame = stack.at(-1);
    if (!frame) throw new TemplateError('SFTPL017', 'Unmatched template #' + command);
    if (command === 'endif') { stack.pop(); active = frame.parent; continue; }
    if (frame.hasElse) throw new TemplateError('SFTPL017', 'Template branch after #else');
    if (command === 'else') { frame.hasElse = true; active = frame.parent && !frame.taken; frame.taken = true; }
    else {
      const condition = conditionValue(expression, values);
      active = frame.parent && !frame.taken && condition;
      frame.taken ||= condition;
    }
  }
  if (stack.length) throw new TemplateError('SFTPL017', 'Unclosed template #if');
  return output.join('');
}
