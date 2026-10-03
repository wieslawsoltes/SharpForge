/** Slice configuration is host input, checked before any execution state changes. */
export function validateSliceBudget(instructionBudget,timeBudgetMs) {
  if(!Number.isSafeInteger(instructionBudget)||instructionBudget<0)throw new RangeError('instructionBudget must be a non-negative safe integer');
  if(typeof timeBudgetMs!=='number'||!Number.isFinite(timeBudgetMs)||timeBudgetMs<0)throw new RangeError('timeBudgetMs must be a non-negative finite number');
}

/** Shared rule for ordinary bytecode and future tiered basic-block executors. */
const clock=()=>performance.now();
export function sliceExpired(work,started,timeBudgetMs,now=clock) {
  return (work&255)===0&&now()-started>=timeBudgetMs;
}
