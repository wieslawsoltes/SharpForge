import { GitError, checkLimit } from './errors.js';

import { compileWildmatch } from './ignore-wildmatch.js';
export { compileWildmatch } from './ignore-wildmatch.js';

function stripTrailingSpaces(line) {
  let end = line.length;
  while (end && line[end - 1] === ' ') {
    let escapes = 0;
    for (let position = end - 2; position >= 0 && line[position] === '\\'; position--) escapes++;
    if (escapes % 2) break;
    end--;
  }
  return line.slice(0, end);
}

/** Parse one ignore file; lower-priority sources are evaluated before nested files. */
export function parseIgnore(text, { base = '', source = '.gitignore', priority = 0, ignoreCase = false } = {}) {
  const rules = [];
  const lines = String(text).replace(/^\ufeff/u, '').split(/\r?\n/u);
  checkLimit(lines.length, 100000, 'Ignore patterns');
  for (let index = 0; index < lines.length; index++) {
    let pattern = stripTrailingSpaces(lines[index]);
    if (!pattern || pattern.startsWith('#')) continue;
    const original = pattern;
    const negative = pattern.startsWith('!');
    if (negative) pattern = pattern.slice(1);
    const directoryOnly = pattern.endsWith('/');
    if (directoryOnly) pattern = pattern.slice(0, -1);
    const anchored = pattern.startsWith('/') || pattern.includes('/');
    if (pattern.startsWith('/')) pattern = pattern.slice(1);
    if (!pattern) continue;
    rules.push({ base: base.replace(/\/$/u, ''), source, priority, line: index + 1, original,
      negative, directoryOnly, anchored, matcher: compileWildmatch(pattern, { ignoreCase }) });
  }
  return rules;
}

/** Ordered ignore matcher, including the rule provenance used by check-ignore -v. */
export class IgnoreMatcher {
  constructor(sources = []) {
    this.rules = [];
    for (const source of sources) this.add(source.text, source);
  }

  add(text, options = {}) {
    this.rules.push(...parseIgnore(text, options));
    this.rules.sort((left, right) => left.priority - right.priority || left.base.split('/').length - right.base.split('/').length);
    return this;
  }

  matchOne(path, isDirectory) {
    let match = null;
    for (const rule of this.rules) {
      if (rule.directoryOnly && !isDirectory) continue;
      if (rule.base && !path.startsWith(`${rule.base}/`)) continue;
      const relative = rule.base ? path.slice(rule.base.length + 1) : path;
      const candidate = rule.anchored ? relative : relative.slice(relative.lastIndexOf('/') + 1);
      if (rule.matcher.test(candidate)) match = rule;
    }
    return match;
  }

  match(path, { isDirectory = false } = {}) {
    const normalized = path.replace(/\/$/u, '');
    const components = normalized.split('/');
    let prefix = '';
    for (let index = 0; index < components.length; index++) {
      prefix = prefix ? `${prefix}/${components[index]}` : components[index];
      const rule = this.matchOne(prefix, index < components.length - 1 || isDirectory);
      if (rule && !rule.negative) return { ignored: true, ...rule, path };
      if (index === components.length - 1) return rule ? { ignored: false, ...rule, path } : null;
    }
    return null;
  }

  test(path, options) {
    return this.match(path, options)?.ignored ?? false;
  }
}

/** Compile glob/literal/icase/top/exclude pathspecs; exclusions apply after positive matches. */
export function compilePathspec(patterns = []) {
  const specs = (typeof patterns === 'string' ? [patterns] : patterns).map(value => {
    let pattern = value;
    let magic = [];
    if (pattern.startsWith(':(')) {
      const end = pattern.indexOf(')');
      if (end < 0) throw new GitError('Corrupt', 'Unterminated pathspec magic', { pattern });
      magic = pattern.slice(2, end).split(',');
      pattern = pattern.slice(end + 1);
    } else if (/^:[!^]/u.test(pattern)) {
      magic = ['exclude'];
      pattern = pattern.slice(2);
    } else if (pattern.startsWith(':/')) {
      magic = ['top'];
      pattern = pattern.slice(2);
    }
    for (const item of magic) {
      if (!['glob', 'literal', 'icase', 'top', 'exclude'].includes(item)) {
        throw new GitError('Unsupported', 'Unsupported pathspec magic', { magic: item });
      }
    }
    if (magic.includes('glob') && magic.includes('literal')) throw new GitError('Corrupt', 'Conflicting pathspec magic');
    const hasGlob = !magic.includes('literal') && /[*?[]/u.test(pattern);
    const matcher = hasGlob ? compileWildmatch(pattern, { pathname: magic.includes('glob'), ignoreCase: magic.includes('icase') }) : null;
    return { pattern, matcher, exclude: magic.includes('exclude'), ignoreCase: magic.includes('icase') };
  });
  const matches = (spec, path) => {
    if (spec.matcher) return spec.matcher.test(path);
    const candidate = spec.ignoreCase ? path.toLowerCase() : path;
    const pattern = spec.ignoreCase ? spec.pattern.toLowerCase() : spec.pattern;
    return !pattern || pattern === '.' || candidate === pattern || candidate.startsWith(`${pattern.replace(/\/$/u, '')}/`);
  };
  return path => (!specs.some(spec => !spec.exclude) || specs.some(spec => !spec.exclude && matches(spec, path)))
    && !specs.some(spec => spec.exclude && matches(spec, path));
}
