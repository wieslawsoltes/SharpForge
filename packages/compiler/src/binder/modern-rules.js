/**
 * Binder rules of the C# 13, 14 and 15 epics (SF-A02-E11, SF-A02-E12), in composition order: class mixins like the
 * rules of ./language-rules.js, which appends this list to its own. A new rule is one import and one line here.
 */
import { ConditionalAssignmentBinding } from './conditional-assignment.js';

export const modernRules = Object.freeze([
  ConditionalAssignmentBinding,
]);
