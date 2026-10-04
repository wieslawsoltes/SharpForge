/**
 * The CIL emitter of one method body (SF-A02-T30): `EmitterCore` composed with one mixin per construct family.
 * A later mixin refines the ones before it (`super.` reaches the earlier handler).
 */
import { EmitterCore } from './emitter-core.js';
import { ConstantEmission } from './emit-constants.js';
import { VariableEmission } from './emit-variables.js';
import { ArithmeticEmission } from './emit-arithmetic.js';
import { ConversionEmission } from './emit-conversions.js';
import { SpanConversionEmission } from './emit-span-conversions.js';
import { DecimalConversionEmission } from './emit-decimal-conversions.js';
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
import { LiftedUserOperatorEmission } from './emit-lifted-user-operators.js';
import { InitializerEmission } from './emit-initializers.js';
import { TypeOperatorEmission } from './emit-type-operators.js';
import { ClosureEmission } from './emit-closures.js';
import { DelegateEmission } from './emit-delegates.js';
import { ReferenceEmission } from './emit-references.js';
import { IndexRangeEmission } from './emit-index-range.js';
import { PrimaryCaptureEmission } from './primary-constructor-captures.js';
import { TupleEmission } from './emit-tuples.js';
import { DeconstructionEmission } from './emit-deconstruction.js';
import { RecordEmission } from './records/emit-records.js';
import { MultiDimensionalArrayEmission } from './emit-multidim-arrays.js';
import { IndexValueEmission } from './emit-index-values.js';
import { ListPatternEmission } from './emit-list-patterns.js';
import { UserOperatorEmission } from './emit-user-operators.js';
import { StateMachineEmission } from './emit-state-machine.js';
import { IteratorEmission } from './emit-iterators.js';
import { AsyncEmission } from './emit-async.js';
import { AsyncTryEmission } from './emit-async-try.js';
import { AsyncIteratorEmission } from './emit-async-iterators.js';
import { ExpressionTreeEmission } from './emit-expression-trees.js';
import { StackAllocEmission } from './emit-stackalloc.js';
import { AnonymousTypeEmission } from './emit-anonymous-types.js';
import { InterpolatedHandlerEmission } from './emit-interpolated-handlers.js';
import { PointerEmission } from './emit-pointers.js';
import { FixedEmission } from './emit-fixed.js';
import { InlineArrayEmission } from './emit-inline-arrays.js';
import { UnionEmission } from './emit-unions.js';
import { DynamicEmission } from './emit-dynamic.js';
import { FunctionPointerEmission } from './emit-function-pointers.js';

const families = [
  ConstantEmission,
  VariableEmission,
  ArithmeticEmission,
  ConversionEmission,
  SpanConversionEmission,
  DecimalConversionEmission,
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
  LiftedUserOperatorEmission,
  InitializerEmission,
  TypeOperatorEmission,
  ClosureEmission,
  DelegateEmission,
  ReferenceEmission,
  IndexRangeEmission,
  PrimaryCaptureEmission,
  TupleEmission,
  DeconstructionEmission,
  RecordEmission,
  MultiDimensionalArrayEmission,
  IndexValueEmission,
  ListPatternEmission,
  UserOperatorEmission,
  StateMachineEmission,
  IteratorEmission,
  AsyncEmission,
  AsyncTryEmission,
  AsyncIteratorEmission,
  ExpressionTreeEmission,
  StackAllocEmission,
  AnonymousTypeEmission,
  InterpolatedHandlerEmission,
  PointerEmission,
  FixedEmission,
  InlineArrayEmission,
  UnionEmission,
  DynamicEmission,
  FunctionPointerEmission,
];

export class MethodEmitter extends families.reduce((composed, family) => family(composed), EmitterCore) {}
