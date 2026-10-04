/**
 * The CIL emitter of one method body (SF-A02-T30): `EmitterCore` composed with one mixin per construct family.
 * A later mixin refines the ones before it (`super.` reaches the earlier handler).
 */
import { EmitterCore } from './emitter-core.js';
import { ConstantEmission } from './emit-constants.js';
import { VariableEmission } from './emit-variables.js';
import { ArithmeticEmission } from './emit-arithmetic.js';
import { ConversionEmission } from './emit-conversions.js';
import { AssignmentEmission } from './emit-assignments.js';
import { BranchEmission } from './emit-branches.js';
import { LoopEmission } from './emit-loops.js';
import { CallEmission } from './emit-calls.js';
import { ObjectEmission } from './emit-objects.js';
import { ArrayEmission } from './emit-arrays.js';
import { StringEmission } from './emit-strings.js';
import { ExceptionEmission } from './emit-exceptions.js';
import { AccessorEmission } from './emit-accessors.js';

const families = [
  ConstantEmission,
  VariableEmission,
  ArithmeticEmission,
  ConversionEmission,
  AssignmentEmission,
  BranchEmission,
  LoopEmission,
  CallEmission,
  ObjectEmission,
  ArrayEmission,
  StringEmission,
  ExceptionEmission,
  AccessorEmission,
];

export class MethodEmitter extends families.reduce((composed, family) => family(composed), EmitterCore) {}
