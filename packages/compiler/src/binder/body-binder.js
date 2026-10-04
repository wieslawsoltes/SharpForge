/**
 * Binding method bodies over the lossless syntax tree with the type-system modules of SF-A02-E01: every expression
 * gets a TypeSymbol, conversions come from conversions/classify.js, calls from overload/resolution.js, operators
 * from overload/operators.js, generic calls from overload/type-inference.js and binder/constraints.js, by-reference
 * rules from binder/ref-kinds.js and friends. The result is a tree of plain bound nodes
 * `{ kind, syntax, type, constantValue, ... }` (see bound/semantic-dump.js) that the later passes consume: definite
 * assignment, the nullable walker, ref safety and lowering.
 *
 * Framework members come from the closed registry bridge, which lists only part of the BCL. A lookup or overload
 * resolution that fails on a registry type is therefore not reported: the expression becomes a silent `Bad` node
 * and the binder records `incomplete`, so no false CS1061/CS1501 is produced for members the registry lacks.
 *
 * The binder is one class composed from one mixin per family of constructs (./body/*.js); each mixin only adds
 * methods and reaches the others through `this`.
 */
import { BinderCore } from './body/binder-core.js';
import { ConversionBinding } from './body/conversions.js';
import { NameBinding } from './body/names.js';
import { CallBinding } from './body/calls.js';
import { CreationBinding } from './body/creation.js';
import { TargetTypedBinding } from './target-typing.js';
import { memberBindings } from './members/index.js';
import { OperatorBinding } from './body/operators.js';
import { TypeTestBinding } from './body/type-tests.js';
import { TupleBinding } from './body/tuples.js';
import { DeconstructionBinding } from './body/deconstruction.js';
import { WithBinding } from './with-expression.js';
import { LambdaBinding } from './body/lambdas.js';
import { LambdaSignatureBinding } from './lambda-signatures.js';
import { PatternBinding } from './body/patterns.js';
import { StructuralPatternBinding } from './body/structural-patterns.js';
import { StackAllocBinding } from './body/stackalloc.js';
import { QueryBinding } from './queries.js';
import { StatementBinding } from './body/statements.js';
import { DeclarationBinding } from './body/declarations.js';
import { FlowStatementBinding } from './body/flow-statements.js';
import { LocalFunctionBinding } from './body/local-functions.js';
import { JumpBinding } from './jumps.js';
import { ExceptionBinding } from './exceptions.js';
import { AnonymousMethodBinding } from './anonymous-methods.js';
import { ArrayBinding } from './arrays.js';
import { UnsafeBinding } from './unsafe.js';
import { ProtectedAccessBinding } from './protected-access.js';
import { languageRules } from './language-rules.js';
import { CSharp6Binding } from './csharp6.js';
import { CallerInfoBinding } from './caller-info.js';
import { AnonymousTypeBinding } from './anonymous-types.js';
import { ExtensionMethodBinding } from './extension-methods.js';
import { DynamicBinding } from './dynamic.js';
import { ComInteropBinding } from './com-interop.js';

const expressionFamilies = [
  ConversionBinding,
  NameBinding,
  CallBinding,
  CreationBinding,
  TargetTypedBinding,
  OperatorBinding,
  TypeTestBinding,
  TupleBinding,
  DeconstructionBinding,
  WithBinding,
  LambdaBinding,
  LambdaSignatureBinding,
  PatternBinding,
  StructuralPatternBinding,
  StackAllocBinding,
  QueryBinding,
  // Last: the member binders refine the creation, name, conversion and lambda families above.
  ...memberBindings,
];
const statementFamilies = [
  StatementBinding,
  DeclarationBinding,
  FlowStatementBinding,
  LocalFunctionBinding,
  JumpBinding,
  ExceptionBinding,
  AnonymousMethodBinding,
  ArrayBinding,
  CSharp6Binding,
  CallerInfoBinding,
  AnonymousTypeBinding,
  ExtensionMethodBinding,
  DynamicBinding,
  ComInteropBinding,
  UnsafeBinding,
  ProtectedAccessBinding,
];
const compose = (base, mixins) => mixins.reduce((composed, mixin) => mixin(composed), base);

/**
 * Binds one body.
 * `new BodyBinder(driver, context)`: `driver` is the semantic analysis (core types, conversions, overload and
 * operator resolvers, type binder, diagnostics sink); `context` says where the body lives: `{ uri, scope,
 * containingType, method, isStatic, returnType, returnRefKind, isAsync, isIterator, isFieldInitializer, parent }`.
 */
export class BodyBinder extends compose(BinderCore, [...expressionFamilies, ...statementFamilies, ...languageRules]) {}

export { dumpSemanticTree } from '../bound/semantic-dump.js';
