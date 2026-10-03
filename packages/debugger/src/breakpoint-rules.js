const hitPattern = /^(?:>=|==|%)?\s*[1-9]\d*$/;
const ruleFields = ['condition','conditionMode','hitCondition','logMessage','oneShot'];

export function sameBreakpointRule(a, b) {
  return ruleFields.every(k => (a?.[k] ?? (k === 'conditionMode' ? 'whenTrue' : k === 'oneShot' ? false : '')) ===
    (b?.[k] ?? (k === 'conditionMode' ? 'whenTrue' : k === 'oneShot' ? false : '')));
}
export function validateBreakpointRule(request, parse) {
  if (request.conditionMode !== undefined && !['whenTrue','whenChanged'].includes(request.conditionMode))
    throw new Error('Condition mode must be whenTrue or whenChanged');
  for (const name of ['condition','logMessage']) if (request[name] !== undefined &&
    (typeof request[name] !== 'string' || request[name].length > 16384)) throw new Error(name + ' must be text of at most 16384 characters');
  if (request.condition) parse(request.condition);
  if (request.conditionMode === 'whenChanged' && !request.condition) throw new Error('When changed requires an expression');
  if (request.hitCondition) {
    const text = String(request.hitCondition).trim(), count = Number(text.replace(/^[^\d]+/,''));
    if (!hitPattern.test(text) || !Number.isSafeInteger(count)) throw new Error('Hit condition must be N, >=N, ==N or %N (positive safe integer)');
  }
  if (request.oneShot !== undefined && typeof request.oneShot !== 'boolean') throw new Error('oneShot must be Boolean');
}
export function hitMatches(bp) {
  if (!bp.hitCondition) return true;
  const s = String(bp.hitCondition).trim(), n = Number(s.replace(/^[^\d]+/,''));
  return s.startsWith('>=') ? bp.hits >= n : s.startsWith('%') ? bp.hits % n === 0 : bp.hits === n;
}
function identity(result, vm) {
  const value = vm.value(result.value);
  if (value && typeof value === 'object') return result.type + ':ref:' + value.h + ':' + value.g;
  if (typeof value === 'number') return result.type + ':' + (Object.is(value,-0) ? '-0' : String(value));
  if (typeof value === 'bigint') return result.type + ':' + value.toString();
  return result.type + ':' + JSON.stringify(value);
}
/** Count all encounters; seed/change conditions are evaluated on every encounter before hit filtering. */
export function evaluateBreakpointRule(bp, evaluate, vm) {
  bp.hits = (bp.hits ?? 0) + 1;
  let conditionMet = true;
  if (bp.condition) {
    const result = evaluate(bp.condition);
    if (bp.conditionMode === 'whenChanged') {
      const current = identity(result, vm);
      conditionMet = bp.conditionSeeded === true && current !== bp.conditionValue;
      bp.conditionValue = current; bp.conditionSeeded = true;
    } else {
      if (result.type !== 'bool') throw new Error('Breakpoint condition must be bool');
      conditionMet = !!result.value;
    }
  }
  return conditionMet && hitMatches(bp);
}
export function formatLogpoint(text, evaluate, format) {
  // Double braces are literal; interpolation never calls target code.
  return text.replace(/\{\{|\}\}|\{([^{}]+)\}/g, (match, expression) => {
    if (match === '{{') return '{'; if (match === '}}') return '}';
    try { return format(evaluate(expression).value); } catch (error) { return `<${error.message}>`; }
  });
}
export function ruleState(bp) {
  return {rule:JSON.stringify(ruleFields.map(k=>bp[k]??null)),id:bp.id,hits:bp.hits ?? 0,conditionSeeded:bp.conditionSeeded,conditionValue:bp.conditionValue,
    consumed:bp.consumed,enabled:bp.enabled};
}
export function restoreRuleState(bp, saved) {
  if (!saved || saved.rule !== JSON.stringify(ruleFields.map(k=>bp[k]??null))) { bp.hits = 0; bp.conditionSeeded = false; delete bp.conditionValue; return; }
  bp.hits = saved.hits; bp.conditionSeeded = saved.conditionSeeded; bp.conditionValue = saved.conditionValue;
  // Restore automatic consumption, never override a user-disabled breakpoint during reverse navigation.
  if (bp.oneShot && bp.consumed) bp.enabled = saved.enabled;
  bp.consumed = saved.consumed;
}
export function publicBreakpoint(bp) {
  const {conditionSeeded,conditionValue,...value} = bp;
  return {...value,locations:value.locations?.map(p => ({...p}))};
}
