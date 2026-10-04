import {PathPolicy} from '@sharpforge/archive';

const defaultIgnored = new Set(['.git', 'node_modules', '.vs', '.sharpforge']);

function globRegex(pattern) {
  let output = '';
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      index++;
      if (pattern[index + 1] === '/') { index++; output += '(?:.*/)?'; }
      else output += '.*';
    } else if (character === '*') output += '[^/]*';
    else if (character === '?') output += '[^/]';
    else if (character === '[') {
      let end = index + 1;
      if (pattern[end] === '!' || pattern[end] === '^') end++;
      if (pattern[end] === ']') end++;
      while (end < pattern.length && pattern[end] !== ']') end++;
      if (end === pattern.length) output += '\\[';
      else {
        let content = pattern.slice(index + 1, end);
        if (content.startsWith('!')) content = '^' + content.slice(1);
        output += '[' + content.replace(/\\/g, '\\\\') + ']';
        index = end;
      }
    }
    else if (character === '\\' && index + 1 < pattern.length) output += pattern[++index].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else output += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return output;
}

/** Ordered .gitignore rules, including negation, anchored patterns, directories, **, ?, and escaped literals. */
export class GitIgnoreMatcher {
  constructor(text = '', {maxRules = 10000} = {}) {
    this.rules = [];
    this.maxRules = maxRules;
    this.append(text);
  }

  append(text, {base = ''} = {}) {
    for (const raw of String(text).split(/\r?\n/)) {
      let line = raw;
      while (line.endsWith(' ')) {
        let slash = line.length - 2;
        while (slash >= 0 && line[slash] === '\\') slash--;
        if ((line.length - 2 - slash) % 2 === 1) break;
        line = line.slice(0, -1);
      }
      if (!line || line.startsWith('#')) continue;
      if (this.rules.length >= this.maxRules) throw new RangeError('Gitignore rule limit exceeded');
      const negate = line.startsWith('!');
      if (negate) line = line.slice(1);
      const anchored = line.startsWith('/');
      if (anchored) line = line.slice(1);
      const directory = line.endsWith('/');
      if (directory) line = line.slice(0, -1);
      if (!line) continue;
      const prefix = anchored || line.includes('/') ? '^' : '(?:^|/)';
      const suffix = directory ? '(?:/|$)' : '(?:$|/)';
      const pattern = prefix + globRegex(line);
      this.rules.push({base, negate, directory, expression: new RegExp(pattern + suffix), descendant: new RegExp(pattern + '/')});
    }
  }

  ignored(path, directory = false) {
    let ignored = false;
    for (const rule of this.rules) {
      if (rule.base && !path.startsWith(rule.base + '/')) continue;
      const relative = rule.base ? path.slice(rule.base.length + 1) : path;
      if (!rule.expression.test(relative)) continue;
      if (rule.directory && !directory && !rule.descendant.test(relative)) continue;
      ignored = !rule.negate;
    }
    return ignored;
  }
}

/** Import outcomes are data, so one rejected path never discards the successfully admitted folder. */
export class WorkspaceImportReport {
  constructor({caseSensitive = false, ignoredFolders = defaultIgnored, gitignore = '', applyGitignore = false,
    maxEntries = 100000} = {}) {
    this.policy = new PathPolicy({caseSensitive});
    this.ignoredFolders = new Set(ignoredFolders);
    this.matcher = applyGitignore ? new GitIgnoreMatcher(gitignore) : null;
    this.maxEntries = maxEntries;
    this.outcomes = [];
    this.identities = new Map();
    this.accepted = 0;
  }

  skip(path, reason, detail = reason) {
    if (this.outcomes.length >= this.maxEntries) throw new RangeError('Import report entry limit exceeded');
    const outcome = {path, status: 'skipped', reason, detail};
    this.outcomes.push(outcome);
    return outcome;
  }

  admit(rawPath, {directory = false, administrative = false} = {}) {
    let path;
    try { path = this.policy.normalize(rawPath, {directory}); }
    catch (error) { this.skip(rawPath, 'non-portable-path', error.message); return null; }
    if (!administrative && path.split('/').some(part => this.ignoredFolders.has(part))) {
      this.skip(path, 'ignored-folder');
      return null;
    }
    if (this.matcher?.ignored(path, directory)) { this.skip(path, 'gitignore'); return null; }
    const key = this.policy.identity(path);
    const previous = this.identities.get(key);
    if (previous !== undefined && previous !== path) {
      this.skip(path, 'case-or-unicode-collision', 'Conflicts with ' + previous);
      return null;
    }
    if (previous !== undefined) { this.skip(path, 'duplicate-path'); return null; }
    let parent = path;
    while (parent.includes('/')) {
      parent = parent.slice(0, parent.lastIndexOf('/'));
      const identity = this.policy.identity(parent);
      const existing = this.identities.get(identity);
      if (existing !== undefined && existing !== parent) {
        this.skip(path, 'case-or-unicode-collision', 'Parent conflicts with ' + existing);
        return null;
      }
    }
    this.identities.set(key, path);
    this.accepted++;
    return path;
  }

  get skipped() { return this.outcomes.filter(outcome => outcome.status === 'skipped'); }
  summary() { return {accepted: this.accepted, skipped: this.skipped.length, outcomes: this.outcomes.slice()}; }
}
