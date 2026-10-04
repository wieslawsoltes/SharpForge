/**
 * Body-binder rules of the C# 13, 14 and 15 epics (SF-A02-E11, SF-A02-E12), in composition order: class mixins like
 * the rules of ./language-rules.js, which appends this list to its own. A new rule is one import and one line here.
 */
import { ConditionalAssignmentBinding } from './conditional-assignment.js';
import { CSharp14Binding } from './csharp14.js';
import { LabeledJumpBinding } from './labeled-jumps.js';
import { FieldKeywordBinding } from './field-keyword.js';
import { ExtensionMemberBinding } from './extension-members.js';
import { ParamsCollectionBinding } from './params-collections.js';
import { UnsafeIteratorBinding } from './unsafe-iterators.js';
import { ClosedTypeBinding } from './closed-types.js';
import { UnsafeExpressionBinding } from './unsafe-expressions.js';
import { CollectionArgumentBinding } from './collection-arguments.js';
import { ExtensionIndexerBinding } from './extension-indexers.js';

export const languageRules13to15 = Object.freeze([
  ConditionalAssignmentBinding,
  ParamsCollectionBinding,
  UnsafeIteratorBinding,
  ExtensionMemberBinding,
  ExtensionIndexerBinding,
  CSharp14Binding,
  LabeledJumpBinding,
  FieldKeywordBinding,
  ClosedTypeBinding,
  UnsafeExpressionBinding,
  CollectionArgumentBinding,
]);
