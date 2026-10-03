/** Conditional compilation: #define, #undef, #if, #elif, #else, #endif and the pp-expression evaluator. */
export class DirectiveState {
  constructor(symbols = []) {
    this.symbols = new Set(symbols);
    this.stack = [];
    this.seenToken = false;
    this.sawIf = false;
  }
  /** True while source text is compiled (every enclosing #if branch was taken). Regions do not affect it. */
  get active() {
    return this.stack.every(entry => entry.kind !== 'if' || entry.branchTaken);
  }
}
/** An immutable copy of the scanner's preprocessor state, recorded after every directive so relexing can resume mid-file. */
export function snapshotDirectiveState(state, previous) {
  const same = previous && previous.symbols.size === state.symbols.size && [...state.symbols].every(symbol => previous.symbols.has(symbol));
  return Object.freeze({
    symbols: same ? previous.symbols : new Set(state.symbols),
    stack: Object.freeze(state.stack.map(entry => Object.freeze({ ...entry }))),
    sawIf: state.sawIf
  });
}
const identifier = /^[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}\p{Cf}]*/u;
/**
 * Evaluates a pp-expression (`A && !B || (C == true)`) against the defined symbols.
 * Returns { value, error, rest } where `rest` is unconsumed text after the expression.
 */
export function evaluatePreprocessorExpression(text, symbols) {
  let i = 0,
    error = null;
  const skip = () => {
      while (/[ \t]/.test(text[i] ?? '')) i++;
    },
    fail = message => {
      error ??= message;
      return false;
    };
  const primary = () => {
    skip();
    if (text[i] === '(') {
      i++;
      const value = or();
      skip();
      if (text[i] === ')') i++;
      else fail(') expected');
      return value;
    }
    if (text[i] === '!' && text[i + 1] !== '=') {
      i++;
      return !primary();
    }
    const name = identifier.exec(text.slice(i))?.[0];
    if (!name) return fail('Invalid preprocessor expression');
    i += name.length;
    return name === 'true' ? true : name === 'false' ? false : symbols.has(name);
  };
  const equality = () => {
    let left = primary();
    for (;;) {
      skip();
      const op = text.substr(i, 2);
      if (op !== '==' && op !== '!=') return left;
      i += 2;
      const right = primary();
      left = op === '==' ? left === right : left !== right;
    }
  };
  const and = () => {
    let left = equality();
    for (;;) {
      skip();
      if (text.substr(i, 2) !== '&&') return left;
      i += 2;
      const right = equality();
      left = left && right;
    }
  };
  const or = () => {
    let left = and();
    for (;;) {
      skip();
      if (text.substr(i, 2) !== '||') return left;
      i += 2;
      const right = and();
      left = left || right;
    }
  };
  const value = or();
  skip();
  return { value: !!value && !error, error, rest: text.slice(i) };
}
const trailing = rest => (/^[ \t]*(?:\/\/.*)?$/.test(rest) ? null : ['CS1025', 'Single-line comment or end-of-line expected']);
const bad = (name, code, message, state) => ({
  kind: 'BadDirectiveTrivia',
  structure: { directive: name, isActive: state.active },
  diagnostics: [[code, message]]
});
/**
 * Applies one conditional or symbol directive to `state`. `rest` is the directive text after its keyword.
 * #if blocks and #region blocks share one stack and must nest properly, as in Roslyn.
 * Returns { kind, structure, diagnostics } or null when `name` is not handled here.
 */
export function scanConditionalDirective(name, rest, state) {
  const diagnostics = [],
    add = entry => {
      if (entry) diagnostics.push(entry);
    },
    top = state.stack.at(-1),
    active = state.active;
  if (name === 'if') {
    const condition = evaluatePreprocessorExpression(rest, state.symbols);
    if (condition.error) add(['CS1517', 'Invalid preprocessor expression']);
    else add(trailing(condition.rest));
    const taken = active && condition.value;
    state.stack.push({ kind: 'if', outer: active, branchTaken: taken, anyTaken: taken, elseSeen: false });
    return {
      kind: 'IfDirectiveTrivia',
      structure: { directive: 'if', condition: rest.trim(), conditionValue: condition.value, branchTaken: taken, isActive: active },
      diagnostics
    };
  }
  if (name === 'elif' || name === 'else' || name === 'endif') {
    if (!top) return bad(name, 'CS1028', 'Unexpected preprocessor directive', state);
    if (top.kind === 'region') return bad(name, 'CS1038', '#endregion directive expected', state);
    if (name === 'endif') {
      state.stack.pop();
      add(trailing(rest));
      return { kind: 'EndIfDirectiveTrivia', structure: { directive: 'endif', isActive: top.outer }, diagnostics };
    }
    if (top.elseSeen) return bad(name, 'CS1028', 'Unexpected preprocessor directive', state);
    const condition = name === 'elif' ? evaluatePreprocessorExpression(rest, state.symbols) : { value: true, rest };
    if (condition.error) add(['CS1517', 'Invalid preprocessor expression']);
    else add(trailing(condition.rest));
    const taken = top.outer && !top.anyTaken && condition.value;
    top.branchTaken = taken;
    top.anyTaken ||= taken;
    if (name === 'else') top.elseSeen = true;
    return {
      kind: name === 'elif' ? 'ElifDirectiveTrivia' : 'ElseDirectiveTrivia',
      structure: {
        directive: name,
        ...(name === 'elif' ? { condition: rest.trim(), conditionValue: condition.value } : {}),
        branchTaken: taken,
        isActive: top.outer
      },
      diagnostics
    };
  }
  if (name === 'define' || name === 'undef') {
    const symbol = /^[ \t]*([\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}\p{Cf}]*)(.*)$/u.exec(rest);
    if (!active) {
      /* lexed but without effect */
    } else if (!symbol || symbol[1] === 'true' || symbol[1] === 'false') add(['CS1001', 'Identifier expected']);
    else if (state.seenToken) add(['CS1032', 'Cannot define/undefine preprocessor symbols after first token in file']);
    else {
      add(trailing(symbol[2]));
      if (name === 'define') state.symbols.add(symbol[1]);
      else state.symbols.delete(symbol[1]);
    }
    return {
      kind: name === 'define' ? 'DefineDirectiveTrivia' : 'UndefDirectiveTrivia',
      structure: { directive: name, name: symbol?.[1] ?? null, isActive: active },
      diagnostics
    };
  }
  if (name === 'region') {
    state.stack.push({ kind: 'region', name: rest.trim() });
    return { kind: 'RegionDirectiveTrivia', structure: { directive: 'region', message: rest.trim(), isActive: active }, diagnostics };
  }
  if (name === 'endregion') {
    if (!top) return bad(name, 'CS1028', 'Unexpected preprocessor directive', state);
    if (top.kind === 'if') return bad(name, 'CS1027', '#endif directive expected', state);
    state.stack.pop();
    return { kind: 'EndRegionDirectiveTrivia', structure: { directive: 'endregion', message: rest.trim(), isActive: active }, diagnostics };
  }
  return null;
}
/** The diagnostic for the innermost #if or #region still open at end of file (Roslyn reports only that one). */
export function unterminatedDirectives(state) {
  const top = state.stack.at(-1);
  return !top ? [] : top.kind === 'region' ? [['CS1038', '#endregion directive expected']] : [['CS1027', '#endif directive expected']];
}
/** Finds the end of a disabled-text run starting at `i` (a line start): whole lines are skipped up to the next line that starts a directive. */
export function scanDisabledText(text, i) {
  while (i < text.length) {
    let j = i;
    while (/[ \t\v\f\u00A0\uFEFF]/.test(text[j] ?? '')) j++;
    if (text[j] === '#') return i;
    while (i < text.length && !/[\r\n\u0085\u2028\u2029]/.test(text[i])) i++;
    if (text[i] === '\r' && text[i + 1] === '\n') i += 2;
    else if (i < text.length) i++;
  }
  return i;
}
