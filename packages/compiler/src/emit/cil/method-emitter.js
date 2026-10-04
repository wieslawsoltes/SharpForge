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
import { SwitchEmission } from './emit-switch.js';
import { PatternEmission } from './emit-patterns.js';
import { CallEmission } from './emit-calls.js';
import { ObjectEmission } from './emit-objects.js';
import { ArrayEmission } from './emit-arrays.js';
import { StringEmission } from './emit-strings.js';
import { ExceptionEmission } from './emit-exceptions.js';
import { LockEmission } from './emit-lock.js';
import { AccessorEmission } from './emit-accessors.js';
import { JumpEmission } from './emit-jumps.js';
import { NullableEmission } from './emit-nullable.js';
import { InitializerEmission } from './emit-initializers.js';
import { TypeOperatorEmission } from './emit-type-operators.js';
import { ClosureEmission } from './emit-closures.js';
import { DelegateEmission } from './emit-delegates.js';
import { ReferenceEmission } from './emit-references.js';
import { IndexRangeEmission } from './emit-index-range.js';
import { PrimaryCaptureEmission } from './primary-constructor-captures.js';
import { StateMachineEmission } from './emit-state-machine.js';
import { IteratorEmission } from './emit-iterators.js';
import { AsyncEmission } from './emit-async.js';
import { AsyncTryEmission } from './emit-async-try.js';

const families = [
  ConstantEmission,
  VariableEmission,
  ArithmeticEmission,
  ConversionEmission,
  AssignmentEmission,
  BranchEmission,
  LoopEmission,
  SwitchEmission,
  PatternEmission,
  CallEmission,
  ObjectEmission,
  ArrayEmission,
  StringEmission,
  ExceptionEmission,
  LockEmission,
  AccessorEmission,
  JumpEmission,
  NullableEmission,
  InitializerEmission,
  TypeOperatorEmission,
  ClosureEmission,
  DelegateEmission,
  ReferenceEmission,
  IndexRangeEmission,
  PrimaryCaptureEmission,
  StateMachineEmission,
  IteratorEmission,
  AsyncEmission,
  AsyncTryEmission,
];

export class MethodEmitter extends families.reduce((composed, family) => family(composed), EmitterCore) {}
