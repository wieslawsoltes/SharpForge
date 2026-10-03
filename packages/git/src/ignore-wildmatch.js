import { GitError, checkLimit } from './errors.js';

const classes = Object.freeze({ alnum: 'A-Za-z0-9', alpha: 'A-Za-z', blank: ' \t', cntrl: '\\x00-\\x1f\\x7f',
  digit: '0-9', graph: '\\x21-\\x7e', lower: 'a-z', print: '\\x20-\\x7e', punct: '!-/:-@[-`{-~',
  space: ' \\t\\r\\n\\v\\f', upper: 'A-Z', xdigit: 'A-Fa-f0-9' });

function tokenize(pattern, pathname) {
  pattern = pattern.replace(/\[:([a-z]+):\]/gu, (match, name) => classes[name] ?? match);
  const tokens = [];
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === '\\') tokens.push({ type: 'literal', value: pattern[++index] ?? '\\' });
    else if (character === '?') tokens.push({ type: 'any' });
    else if (character === '*') {
      const start = index;
      while (pattern[index + 1] === '*') index++;
      const recursive = index > start && (start === 0 || pattern[start - 1] === '/')
        && (index + 1 === pattern.length || pattern[index + 1] === '/');
      if (recursive && pattern[index + 1] === '/') {
        tokens.push({ type: 'directories' });
        index++;
      } else tokens.push({ type: recursive || !pathname ? 'globstar' : 'star' });
    } else if (character === '[') {
      let stop = index + 1;
      if (pattern[stop] === '!' || pattern[stop] === '^') stop++;
      if (pattern[stop] === ']') stop++;
      while (stop < pattern.length && pattern[stop] !== ']') stop++;
      if (stop === pattern.length) tokens.push({ type: 'literal', value: '[' });
      else {
        let content = pattern.slice(index + 1, stop);
        if (content.startsWith('!')) content = `^${content.slice(1)}`;
        if (content.startsWith(']')) content = `\\]${content.slice(1)}`;
        if (content.startsWith('^]')) content = `^\\]${content.slice(2)}`;
        try { tokens.push({ type: 'class', matcher: new RegExp(`^[${content}]$`, 'u') }); }
        catch { throw new GitError('Corrupt', 'Invalid Git wildcard character class', { pattern }); }
        index = stop;
      }
    } else tokens.push({ type: 'literal', value: character });
  }
  return tokens;
}

function matchTokens(tokens, path, pathname, maximum) {
  checkLimit(tokens.length * (path.length + 1), maximum, 'Wildcard matching work');
  let previous = new Uint8Array(path.length + 1);
  let next = new Uint8Array(path.length + 1);
  previous[0] = 1;
  for (const token of tokens) {
    next.fill(0);
    if (token.type === 'star' || token.type === 'globstar') {
      next[0] = previous[0];
      for (let index = 1; index <= path.length; index++) {
        next[index] = previous[index] || (next[index - 1] && (token.type === 'globstar' || path[index - 1] !== '/')) ? 1 : 0;
      }
    } else if (token.type === 'directories') {
      let reachable = previous[0];
      next[0] = previous[0];
      for (let index = 1; index <= path.length; index++) {
        next[index] = previous[index] || (reachable && path[index - 1] === '/') ? 1 : 0;
        reachable ||= previous[index];
      }
    } else {
      for (let index = 1; index <= path.length; index++) {
        if (!previous[index - 1]) continue;
        const character = path[index - 1];
        const allowed = !pathname || character !== '/';
        if (token.type === 'literal' ? character === token.value
          : token.type === 'any' ? allowed : allowed && token.matcher.test(character)) next[index] = 1;
      }
    }
    [previous, next] = [next, previous];
  }
  return previous[path.length] === 1;
}

/** Bounded O(pattern × path) wildcard automaton; repository patterns cannot cause regex backtracking. */
export function compileWildmatch(pattern, { pathname = true, ignoreCase = false, maxWork = 8000000 } = {}) {
  checkLimit(pattern.length, 8192, 'Git pattern length');
  const original = pattern;
  if (ignoreCase) pattern = pattern.toLowerCase();
  const tokens = tokenize(pattern, pathname);
  const literal = tokens.every(token => token.type === 'literal') ? tokens.map(token => token.value).join('') : null;
  return { source: original, test(path) {
    checkLimit(path.length, 32768, 'Git wildcard path length');
    const candidate = ignoreCase ? path.toLowerCase() : path;
    return literal !== null ? candidate === literal : matchTokens(tokens, candidate, pathname, maxWork);
  } };
}
