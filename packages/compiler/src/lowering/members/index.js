/**
 * The member lowerings of SF-A02-T10 as translator mixins, in composition order (a later mixin may refine an earlier
 * one through `super`). The body translator composes them after its own expression and statement families.
 */
import { EvaluateOnce } from './evaluate-once.js';
import { InitializerLowering } from './initializers.js';
import { OperatorLowering } from './operators.js';
import { PrimaryConstructorLowering, PrimaryConstructorGeneration } from './primary-constructors.js';
import { PartialMemberLowering, PartialMemberGeneration } from './partial-members.js';
import { ExpressionTreeTranslation } from '../expression-trees.js';
import { ExtensionMemberGeneration, ExtensionIndexerLowering } from './extension-members.js';

export const memberLowerings = Object.freeze([
  EvaluateOnce,
  InitializerLowering,
  OperatorLowering,
  PrimaryConstructorLowering,
  PartialMemberLowering,
  ExpressionTreeTranslation,
  ExtensionIndexerLowering,
]);

/** Generator mixins of the member lowerings, composed over the generator's own declaration and initialization passes. */
export const memberGenerators = Object.freeze([PrimaryConstructorGeneration, PartialMemberGeneration, ExtensionMemberGeneration]);
