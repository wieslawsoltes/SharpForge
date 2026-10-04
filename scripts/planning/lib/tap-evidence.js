const countNames = {
  tests: 'tests', pass: 'passed', fail: 'failed', cancelled: 'cancelled', skipped: 'skipped', todo: 'todo', suites: 'suites',
};
const requiredCounts = ['tests', 'passed', 'failed', 'cancelled', 'skipped', 'todo'];
const maximumLength = 64 * 1024 * 1024;
const maximumLines = 1_000_000;
const maximumDepth = 128;

function scopeAt(indent) {
  return { indent, results: [], numbers: new Set(), plan: null, trailingPlan: false, header: false, pending: null };
}

function unescapeTap(text) {
  return text.replace(/\\([\\#])/g, '$1');
}

function readComment(state, text, indent) {
  if (indent % 4 !== 0) {
    state.complete = false;
    return;
  }
  const proof = /^# sharpforge-evidence: (.+)$/.exec(text);
  if (proof) state.proofs.push(unescapeTap(proof[1]));
  if (indent !== 0) return;
  const counter = /^# (tests|pass|fail|cancelled|skipped|todo|suites)(?:\s|$)/.exec(text);
  if (!counter) return;
  state.firstCounter ??= state.index;
  const match = /^# \w+ (\d+)\s*$/.exec(text);
  const name = countNames[counter[1]];
  const value = Number(match?.[1]);
  if (!match || !Number.isSafeInteger(value) || Object.hasOwn(state.counts, name)) state.complete = false;
  state.counts[name] = Number.isSafeInteger(value) ? value : 0;
}

function readPoint(state, scope, match) {
  const number = Number(match[2]);
  const description = match[3] ?? '';
  const directive = /(?:^|\s+)#\s*(SKIP|TODO)\b/i.exec(description);
  const name = description.slice(0, directive?.index ?? description.length).replace(/^-\s?/, '').trimEnd();
  if (!Number.isSafeInteger(number) || number < 1 || scope.numbers.has(number) || scope.trailingPlan) state.complete = false;
  scope.numbers.add(number);
  const result = {
    ok: match[1] === 'ok', name: unescapeTap(name), directive: directive?.[1].toUpperCase(), type: 'test', children: scope.pending,
  };
  scope.pending = null;
  scope.results.push(result);
  state.results.push(result);
}

function readPlan(state, scope, match) {
  const count = Number(match[1]);
  if (scope.plan !== null || scope.pending || !Number.isSafeInteger(count)) state.complete = false;
  if (/^\s*SKIP\b/i.test(match[2] ?? '') && count !== 0) state.complete = false;
  scope.plan = count;
  scope.trailingPlan = scope.results.length > 0;
}

function readDiagnostic(state, scope) {
  const result = scope.results.at(-1);
  const indent = scope.indent + 2;
  if (!result || result.diagnostic || scope.pending || scope.trailingPlan) state.complete = false;
  if (result) result.diagnostic = true;
  let hasType = false;
  state.index++;
  while (state.index < state.lines.length) {
    const line = state.lines[state.index];
    const spaces = line.length - line.trimStart().length;
    if (spaces === indent && line.trim() === '...') {
      state.index++;
      return;
    }
    // A dedent cannot terminate YAML: a missing terminator makes the evidence incomplete.
    if (line.trim() && spaces < indent) break;
    if (spaces === indent && /^type:/.test(line.trimStart())) {
      const type = /^type: (?:'(test|suite)'|"(test|suite)"|(test|suite))\s*$/.exec(line.trimStart());
      if (hasType || !type) state.complete = false;
      if (result && type) result.type = type[1] ?? type[2] ?? type[3];
      hasType = true;
    }
    state.index++;
  }
  state.complete = false;
}

function readNested(state, scope, spaces, text) {
  if (spaces === scope.indent + 2 && text === '---') {
    readDiagnostic(state, scope);
    return;
  }
  if (spaces !== scope.indent + 4 || scope.pending || scope.trailingPlan || spaces / 4 > maximumDepth) {
    state.complete = false;
    state.index++;
    return;
  }
  scope.pending = readScope(state, spaces);
}

function readStatement(state, scope, text) {
  const point = /^(not ok|ok) (\d+)(?:\s+(.*))?$/.exec(text);
  const plan = /^1\.\.(\d+)(?:\s+#(.*))?$/.exec(text);
  if (point) readPoint(state, scope, point);
  else if (plan) readPlan(state, scope, plan);
  else if (text === 'TAP version 13') {
    if (scope.header || scope.results.length || scope.plan !== null || scope.pending) state.complete = false;
    scope.header = true;
  } else state.complete = false;
  state.lastStatement = state.index;
  state.index++;
}

function readScope(state, indent) {
  const scope = scopeAt(indent);
  while (state.index < state.lines.length) {
    const line = state.lines[state.index];
    const text = line.trimStart();
    const spaces = line.length - text.length;
    if (!/^ *$/.test(line.slice(0, spaces))) state.complete = false;
    if (!text) {
      state.index++;
      continue;
    }
    // Node emits stdout comments at the root even while a nested test is running.
    if (text.startsWith('#')) {
      if (spaces > indent) readNested(state, scope, spaces, text);
      else {
        readComment(state, text, spaces);
        state.index++;
      }
      continue;
    }
    if (/^Bail out!/i.test(text)) state.complete = false;
    if (spaces < indent) break;
    if (spaces > indent) readNested(state, scope, spaces, text);
    else readStatement(state, scope, text);
  }
  if (scope.pending || scope.plan === null || scope.plan !== scope.results.length) state.complete = false;
  for (const number of scope.numbers) if (number > scope.plan) state.complete = false;
  return scope;
}

function annotateResults(scope, inheritedDirective = false) {
  for (const result of scope.results) {
    result.inheritedDirective = inheritedDirective;
    const excluded = inheritedDirective || Boolean(result.directive);
    if (result.children) annotateResults(result.children, excluded);
    const descendantPassed = result.children?.results.some(child => child.executedPass) ?? false;
    result.executedPass = result.ok && !excluded && (result.type === 'test' || descendantPassed);
  }
}

function validateCounts(state) {
  const observed = { tests: 0, passed: 0, failed: 0, skipped: 0, todo: 0, suites: 0 };
  for (const result of state.results) {
    if (result.type === 'suite') observed.suites++;
    else {
      observed.tests++;
      if (result.directive === 'SKIP') observed.skipped++;
      else if (result.directive === 'TODO') observed.todo++;
      else if (result.ok) observed.passed++;
      else observed.failed++;
    }
  }
  if (requiredCounts.some(name => !Object.hasOwn(state.counts, name))) state.complete = false;
  if (state.firstCounter === undefined || state.firstCounter < state.lastStatement) state.complete = false;
  for (const name of ['tests', 'passed', 'skipped', 'todo']) {
    if (state.counts[name] !== observed[name]) state.complete = false;
  }
  // TAP reports failure and cancellation as "not ok"; Node counts both separately in the trailer.
  if (state.counts.failed + state.counts.cancelled !== observed.failed) state.complete = false;
  if ((state.counts.suites ?? 0) !== observed.suites) state.complete = false;
}

/** Read bounded Node TAP 13 evidence; unsupported or malformed streams are incomplete, never passing proof. */
export function readTapEvidence(tap) {
  const state = { complete: true, counts: {}, results: [], proofs: [], index: 0, lastStatement: -1 };
  if (typeof tap !== 'string' || tap.length > maximumLength) return { ...state, complete: false };
  state.lines = tap.split(/\r\n?|\n/, maximumLines + 1);
  if (state.lines.length > maximumLines) return { ...state, complete: false };
  if (state.lines[0] !== 'TAP version 13') state.complete = false;
  const root = readScope(state, 0);
  annotateResults(root);
  validateCounts(state);
  return { complete: state.complete, counts: state.counts, results: state.results, proofs: state.proofs };
}

/** Preserve the evidence summary contract while binding counters to complete result and plan structure. */
export function summarizeTap(parsed, exitCode) {
  const totals = Object.fromEntries(requiredCounts.map(name => [name, parsed.counts[name] ?? 0]));
  const status = Number.isInteger(exitCode) && exitCode >= 0 ? exitCode : 1;
  // Node excludes suite wrappers from failure counters, but an unexcluded failing suite still requires a failing exit status.
  const failedSuite = parsed.results.some(result => result.type === 'suite' && !result.ok && !result.directive && !result.inheritedDirective);
  return { ...totals, exitCode: status, complete: parsed.complete && (status !== 0 || !failedSuite) };
}
