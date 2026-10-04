import {Rules} from '../../vendor/linebreak/index.js';
import {DrawingError} from '../drawing/commands.js';

/** Unicode17 UAX14 opportunities. A finite operation budget bounds upstream lookahead on adversarial text. */
export function lineOpportunities(text, {maxSteps = 4000000, signal} = {}) {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 8000000) {
    throw new DrawingError('SFRENDER082', 'Invalid line-break work budget');
  }
  let steps = 0;
  const rules = new Rules({work: () => {
    if (++steps > maxSteps) throw new DrawingError('SFRENDER082', 'Line-break work budget exceeded');
    if ((steps & 1023) === 0) signal?.throwIfAborted();
  }});
  const opportunities = new Map();
  for (const point of rules.breaks(text)) {
    opportunities.set(point.position, Boolean(point.required));
  }
  opportunities.set(text.length, true);
  return opportunities;
}
