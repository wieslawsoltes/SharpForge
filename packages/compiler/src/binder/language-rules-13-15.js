/**
 * Body-binder rules of the C# 13, 14 and 15 epics (SF-A02-E11, SF-A02-E12), in composition order: class mixins like
 * the rules of ./language-rules.js, which appends this list to its own. A new rule is one import and one line here.
 */
import { ConditionalAssignmentBinding } from './conditional-assignment.js';
import { FieldKeywordBinding } from './field-keyword.js';
import { ParamsCollectionBinding } from './params-collections.js';

export const languageRules13to15 = Object.freeze([
  ConditionalAssignmentBinding,
  FieldKeywordBinding,
  ParamsCollectionBinding,
]);
