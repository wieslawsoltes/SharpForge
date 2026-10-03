/**
 * The core of the body binder: scopes and locals, diagnostics, conversions of bound expressions and the
 * expression dispatcher. The expression and statement families are class mixins composed in ../body-binder.js.
 */
import { TypeKind, ErrorTypeSymbol } from '../../symbols/types.js';
import { MethodKind, LocalSymbol, LocalDeclarationKind } from '../../symbols/members.js';
import { ConstantValue, isFoldError } from '../../constants/constant-value.js';
import { foldConversion, defaultValue } from '../../constants/fold.js';
import { Conversion, ConversionKind } from '../../conversions/classify.js';
import { numericKind } from '../../conversions/numeric.js';
import { classifyConstantNarrowing } from '../../conversions/constant-narrowing.js';
import { isNullableType, stripNullable } from '../../conversions/nullable.js';
import { delegateInvoke } from '../../overload/type-inference.js';
import { isAccessible } from '../accessibility.js';

const unknown = ErrorTypeSymbol.unknown;
const binaryOperators = {
  AddExpression: '+',
  SubtractExpression: '-',
  MultiplyExpression: '*',
  DivideExpression: '/',
  ModuloExpression: '%',
  LeftShiftExpression: '<<',
  RightShiftExpression: '>>',
  UnsignedRightShiftExpression: '>>>',
  LogicalOrExpression: '||',
  LogicalAndExpression: '&&',
  BitwiseOrExpression: '|',
  BitwiseAndExpression: '&',
  ExclusiveOrExpression: '^',
  EqualsExpression: '==',
  NotEqualsExpression: '!=',
  LessThanExpression: '<',
  LessThanOrEqualExpression: '<=',
  GreaterThanExpression: '>',
  GreaterThanOrEqualExpression: '>=',
};
const unaryOperators = { UnaryPlusExpression: '+', UnaryMinusExpression: '-', BitwiseNotExpression: '~', LogicalNotExpression: '!' };
const keywordOf = type =>
  numericKind(type) ??
  { System_Boolean: 'bool', System_String: 'string', System_Char: 'char', System_Object: 'object' }[type?.specialType] ??
  null;

export class BinderCore {
  /**
   * @param driver `{core,conversions,overloads,operators,typeBinder,report(uri,node,code,args),versionOf(uri),gate(uri,node,key,fallback),nullableAt(uri,pos)}`
   * @param context `{uri,scope,containingType,method,isStatic,returnType,returnRefKind,isAsync,isIterator,isFieldInitializer,parent}`
   */
  constructor(driver, context) {
    this.d = driver;
    this.core = driver.core;
    this.conversions = driver.conversions;
    this.c = context;
    this.scopes = [new Map()];
    this.pending = [new Set()];
    this.locals = [];
    this.loopDepth = 0;
    this.switchDepth = 0;
    this.catchDepth = 0;
    this.finallyDepth = 0;
    this.quiet = context.quiet ?? null;
    this.incomplete = false;
    this.returns = [];
    this.checked = false;
    this.localFunctions = [];
    this.usesGoto = false;
    for (const p of context.parameters ?? context.method?.parameters ?? []) if (p.name) this.scopes[0].set(p.name, p);
  }
  // ---- infrastructure ----
  report(node, code, args = []) {
    if (this.quiet) {
      this.quiet.push({ node, code, args });
      return;
    }
    this.d.report(this.c.uri, node, code, args);
  }
  node(kind, syntax, type, props) {
    const n = { kind, syntax, type: type ?? null, constantValue: null, ...props };
    if (kind === 'MethodGroup' && !n.convert) n.convert = to => this.groupConversion(n, to);
    return n;
  }
  bad(syntax, props) {
    return { kind: 'Bad', syntax, type: unknown, hasErrors: true, constantValue: null, ...props };
  }
  /** A silent failure caused by the closed framework registry. */
  lenient(syntax) {
    this.incomplete = true;
    this.d.incomplete = true;
    return this.bad(syntax);
  }
  get version() {
    return this.d.versionOf(this.c.uri);
  }
  lookupLocal(name) {
    for (let b = this; b; b = b.c.parent) {
      for (let i = b.scopes.length - 1; i >= 0; i--) {
        const s = b.scopes[i].get(name);
        if (s) {
          if (b !== this) s.isCaptured = true;
          return s;
        }
      }
    }
    return null;
  }
  isPending(name) {
    for (let i = this.pending.length - 1; i >= 0; i--) if (this.pending[i].has(name)) return true;
    return false;
  }
  declare(name, symbol, node) {
    const current = this.scopes.at(-1);
    if (current.has(name)) {
      this.report(node, 'CS0128', [name]);
      return symbol;
    }
    for (let b = this; b; b = b.c.parent) {
      const from = b === this ? this.scopes.length - 2 : b.scopes.length - 1;
      for (let i = from; i >= 0; i--)
        if (b.scopes[i].has(name)) {
          this.report(node, 'CS0136', [name]);
          current.set(name, symbol);
          return symbol;
        }
    }
    // A name declared later in an enclosing scope also conflicts (the outer local's scope is its whole block).
    for (let i = this.pending.length - 2; i >= 0; i--)
      if (this.pending[i].has(name)) {
        this.report(node, 'CS0136', [name]);
        break;
      }
    current.set(name, symbol);
    this.pending.at(-1).delete(name);
    return symbol;
  }
  pushScope(pendingNames = []) {
    this.scopes.push(new Map());
    this.pending.push(new Set(pendingNames));
  }
  popScope() {
    this.scopes.pop();
    this.pending.pop();
  }
  newLocal(name, type, syntax, kind = LocalDeclarationKind.Regular, extra = {}) {
    const local = new LocalSymbol({
      name,
      type: type ?? unknown,
      declarationKind: kind,
      containingSymbol: this.c.method,
      syntax,
      locations: [{ uri: this.c.uri, start: syntax.span.start, end: syntax.span.end }],
      ...extra,
    });
    local.reads = 0;
    local.writes = 0;
    local.depth = this.scopes.length - 1;
    this.locals.push(local);
    this.rootBinder.allLocals.push(local);
    return local;
  }
  get rootBinder() {
    let b = this;
    while (b.c.parent) b = b.c.parent;
    b.allLocals ??= [];
    return b;
  }
  bindType(syntax, options) {
    return this.d.typeBinder.bindType(syntax, this.typeScope, options);
  }
  get typeScope() {
    return this.c.scope;
  }
  display(type) {
    return type ? type.toDisplayString() : '<null>';
  }
  // ---- conversions ----
  /** Converts a bound expression to a type implicitly, reporting the Roslyn diagnostic when no conversion exists. */
  convert(e, type, node = e.syntax, { argument = null } = {}) {
    if (!type || e.hasErrors || type.isErrorType() || e.type?.isErrorType?.()) return e;
    if (e.kind === 'TypeExpression' || e.kind === 'NamespaceExpression') {
      this.report(e.syntax, 'CS0119', [
        e.kind === 'TypeExpression' ? this.display(e.referencedType) : e.namespace.toDisplayString(),
        e.kind === 'TypeExpression' ? 'type' : 'namespace',
      ]);
      return this.bad(node);
    }
    if (e.type && !e.literal && !e.form && !e.constantValue && e.type.equals(type)) return e;
    const c = this.conversions.classifyFromExpression(e, type);
    if (c.exists && c.isImplicit && !c.isAmbiguous) return this.applyConversion(e, type, c, node);
    this.reportConversionFailure(e, type, node, c);
    return this.bad(node, { operand: e });
  }
  applyConversion(e, type, c, node = e.syntax, isExplicit = false) {
    if (c.kind === ConversionKind.Identity && e.type && !e.constantValue?.isEnum && e.type.equals(type)) return e;
    if (
      e.materialize &&
      (c.kind === ConversionKind.ObjectCreation ||
        c.kind === ConversionKind.CollectionExpression ||
        e.isTargetTypedConditional ||
        e.isTargetTypedSwitch)
    )
      return e.materialize(type);
    if (e.form === 'lambda' && c.kind === ConversionKind.AnonymousFunction) {
      e.boundAs = type;
      return this.node('Conversion', node, type, { operand: e, conversion: c, isExplicit });
    }
    const result = this.node('Conversion', node, type, {
      operand: e,
      conversion: c,
      isExplicit,
      isImplicitIdentity: c.kind === ConversionKind.Identity,
    });
    if (e.constantValue) {
      const target = type.typeKind === TypeKind.Enum ? type : keywordOf(stripNullable(type));
      if (target && !isNullableType(type)) {
        const folded = foldConversion(e.constantValue, target, { checked: !this.uncheckedContext });
        if (isFoldError(folded)) {
          this.report(node, folded.error.code, folded.error.args);
          result.hasErrors = true;
        } else if (folded) result.constantValue = folded;
      } else if (e.constantValue.isNull && type.isReferenceType === true)
        result.constantValue = ConstantValue.null(keywordOf(type) ?? 'object');
    }
    return result;
  }
  reportConversionFailure(e, type, node, c) {
    const to = this.display(type);
    if (c?.isAmbiguous) {
      this.report(node, 'CS0457', [c.candidates[0].toDisplayString(), c.candidates[1]?.toDisplayString() ?? '', this.display(e.type), to]);
      return;
    }
    if (e.literal === 'null') {
      this.report(node, 'CS0037', [to]);
      return;
    }
    if (e.form === 'methodGroup') {
      const r = e.lastConversionError,
        at = e.nameNode && node === e.syntax ? e.nameNode : node;
      if (r && delegateInvoke(type)) {
        this.report(at, r.code, r.args);
        return;
      }
      this.report(at, 'CS0428', [e.name, to]);
      return;
    }
    if (e.form === 'lambda') {
      const r = e.lastConversionError;
      if (r) for (const x of r) this.report(x.node ?? node, x.code, x.args);
      else this.report(node, 'CS1660', [e.isAnonymousMethod ? 'anonymous method' : 'lambda expression', to]);
      return;
    }
    if (e.noNaturalType) {
      this.report(node, 'CS0173', [this.operandDisplay(e.noNaturalType.left), this.operandDisplay(e.noNaturalType.right)]);
      return;
    }
    if (e.isTargetTypedSwitch) {
      this.report(node, 'CS8506');
      return;
    }
    if (e.form === 'implicitNew') {
      this.report(node, 'CS8752', [to]);
      return;
    }
    if (!e.type) {
      this.report(node, 'CS0029', ['?', to]);
      return;
    }
    if (e.type.specialType === 'System_Void') {
      this.report(node, 'CS0029', ['void', to]);
      return;
    }
    const from = this.display(e.type);
    // Numeric constants: CS0031 when the value does not fit, CS0664 for a double literal assigned to float/decimal.
    if (e.constantValue && !e.constantValue.isNull) {
      const a = this.conversions.kindOf(e.type),
        b = this.conversions.kindOf(stripNullable(type));
      if (a && b) {
        const r = classifyConstantNarrowing(a, e.constantValue.isIntegral ? e.constantValue.bigint : null, b, {
          isRealLiteral: e.kind === 'Literal' && a === 'double',
          display: e.constantValue.displayValue,
        });
        if (r && r.code && r.code !== 'CS0266') {
          this.report(node, r.code, r.args);
          return;
        }
      }
    }
    const explicit = this.conversions.classifyExplicit(e.type, type);
    this.report(node, explicit.exists ? 'CS0266' : 'CS0029', [from, to]);
  }
  /** Binds an expression that must produce a value (not a type, namespace or bare method group). */
  value(syntax, options) {
    return this.asValue(this.expression(syntax, options));
  }
  asValue(e) {
    if (e.hasErrors) {
      if (e.kind === 'Local') e.local.reads++;
      return e;
    }
    if (e.kind === 'TypeExpression') {
      this.report(e.syntax, 'CS0119', [this.display(e.referencedType), 'type']);
      return this.bad(e.syntax);
    }
    if (e.kind === 'NamespaceExpression') {
      this.report(e.syntax, 'CS0119', [e.namespace.toDisplayString(), 'namespace']);
      return this.bad(e.syntax);
    }
    return this.markRead(e);
  }
  markRead(e) {
    if (e.kind === 'PropertyAccess' && !e.readChecked) {
      e.readChecked = true;
      const p = e.property;
      if (!p.getMethod && p.setMethod) this.report(e.syntax, 'CS0154', [p.toDisplayString()]);
      else if (
        p.getMethod &&
        p.getMethod.declaredAccessibility !== p.declaredAccessibility &&
        !isAccessible(p.getMethod.originalDefinition ?? p.getMethod, this.c.containingType?.originalDefinition ?? null, {
          withinModule: this.d.assembly.module,
        })
      )
        this.report(e.syntax, 'CS0271', [p.toDisplayString()]);
    }
    if (e.kind === 'Local') {
      e.local.reads++;
    } else if (e.kind === 'FieldAccess') {
      const f = e.field.originalDefinition ?? e.field;
      f.reads = (f.reads ?? 0) + 1;
    } else if (e.kind === 'MethodGroup' && e.methods.length === 1 && e.methods[0].methodKind === MethodKind.LocalFunction)
      e.methods[0].uses = (e.methods[0].uses ?? 0) + 1;
    return e;
  }
  markWrite(e, value) {
    if (e.kind === 'Local') {
      e.local.writes++;
      if (value && !(value.constantValue || value.literal || value.kind === 'Default')) e.local.nonConstantWrite = true;
    } else if (e.kind === 'FieldAccess') {
      const f = e.field.originalDefinition ?? e.field;
      f.writes = (f.writes ?? 0) + 1;
      if ((value && !(value.constantValue || value.literal || value.kind === 'Default')) || !value) f.nonConstantWrite = true;
    }
  }
  /** Binds and converts to bool (conditions), accepting `operator true`. */
  condition(syntax) {
    const e = this.value(syntax);
    if (e.hasErrors || !e.type) return e.type ? e : this.convert(e, this.core.bool);
    if (e.type.specialType === 'System_Boolean') return e;
    const c = this.conversions.classifyFromExpression(e, this.core.bool);
    if (c.exists && c.isImplicit) return this.applyConversion(e, this.core.bool, c);
    const op = this.d.operators.trueOperator(e.type);
    if (op) return this.node('UserDefinedCondition', syntax, this.core.bool, { operand: e, method: op });
    return this.convert(e, this.core.bool);
  }
  // ---- expressions ----
  expression(syntax, options = {}) {
    const kind = syntax.kind;
    if (binaryOperators[kind]) return this.binary(syntax, binaryOperators[kind]);
    if (unaryOperators[kind]) return this.unary(syntax, unaryOperators[kind]);
    if (kind.endsWith('AssignmentExpression')) return this.assignment(syntax);
    switch (kind) {
      case 'ParenthesizedExpression':
        return this.expression(syntax.expression, options);
      case 'NumericLiteralExpression': {
        const v = syntax.token.value;
        if (!v || !v.type) return this.bad(syntax);
        const type = this.core.keyword(v.type);
        let constant = null;
        try {
          constant = ConstantValue.of(v.type, v.value);
        } catch {
          constant = null;
        }
        const n = this.node('Literal', syntax, type);
        n.constantValue = constant;
        return n;
      }
      case 'TrueLiteralExpression':
      case 'FalseLiteralExpression': {
        const n = this.node('Literal', syntax, this.core.bool);
        n.constantValue = ConstantValue.bool(kind === 'TrueLiteralExpression');
        return n;
      }
      case 'StringLiteralExpression':
      case 'Utf8StringLiteralExpression': {
        const n = this.node('Literal', syntax, this.core.string);
        if (kind === 'Utf8StringLiteralExpression') return this.lenient(syntax);
        n.constantValue = ConstantValue.string(syntax.token.value ?? '');
        return n;
      }
      case 'CharacterLiteralExpression': {
        const n = this.node('Literal', syntax, this.core.char);
        const v = syntax.token.value;
        if (typeof v === 'string' && v.length === 1) n.constantValue = ConstantValue.char(v);
        return n;
      }
      case 'NullLiteralExpression': {
        const n = this.node('Literal', syntax, null, { literal: 'null' });
        n.constantValue = ConstantValue.null();
        return n;
      }
      case 'DefaultLiteralExpression':
        return this.node('Literal', syntax, null, { literal: 'default' });
      case 'IdentifierName':
        return this.identifier(syntax, options);
      case 'GenericName':
        return this.identifier(syntax, options);
      case 'PredefinedType':
        return this.node('TypeExpression', syntax, null, { referencedType: this.core.keyword(syntax.keyword.text) ?? unknown });
      case 'ThisExpression': {
        if (this.c.isStatic || !this.c.containingType) {
          this.report(syntax, this.c.isFieldInitializer && !this.c.isStaticInitializer ? 'CS0027' : 'CS0026');
          return this.bad(syntax);
        }
        if (this.c.isFieldInitializer) {
          this.report(syntax, 'CS0027');
          return this.bad(syntax);
        }
        return this.node('This', syntax, this.c.containingType);
      }
      case 'BaseExpression': {
        if (this.c.isStatic || !this.c.containingType) {
          this.report(syntax, 'CS1511');
          return this.bad(syntax);
        }
        const base = this.c.containingType.baseType;
        if (!base) return this.bad(syntax);
        return this.node('Base', syntax, base, { isBase: true });
      }
      case 'SimpleMemberAccessExpression':
        return this.memberAccess(syntax, options);
      case 'InvocationExpression':
        return this.invocation(syntax);
      case 'ElementAccessExpression':
        return this.elementAccess(syntax);
      case 'ObjectCreationExpression':
        return this.objectCreation(syntax);
      case 'ImplicitObjectCreationExpression':
        return this.implicitCreation(syntax);
      case 'ArrayCreationExpression':
      case 'ImplicitArrayCreationExpression':
        return this.arrayCreation(syntax);
      case 'CastExpression':
        return this.cast(syntax);
      case 'ConditionalExpression':
        return this.conditional(syntax);
      case 'CoalesceExpression':
        return this.coalesce(syntax);
      case 'IsExpression':
      case 'IsPatternExpression':
        return this.isExpression(syntax);
      case 'AsExpression':
        return this.asExpression(syntax);
      case 'PreIncrementExpression':
      case 'PreDecrementExpression':
      case 'PostIncrementExpression':
      case 'PostDecrementExpression':
        return this.increment(syntax);
      case 'SuppressNullableWarningExpression': {
        const e = this.expression(syntax.operand, options);
        return e.hasErrors ? e : { ...e, syntax, suppressed: true };
      }
      case 'DefaultExpression': {
        const type = this.bindType(syntax.type).type;
        const n = this.node('Default', syntax, type);
        if (
          !type.isErrorType() &&
          !isNullableType(type) &&
          (keywordOf(type) || type.typeKind === TypeKind.Enum || type.isReferenceType === true)
        ) {
          try {
            n.constantValue = defaultValue(type.typeKind === TypeKind.Enum ? type : (keywordOf(type) ?? 'object'));
          } catch {
            n.constantValue = null;
          }
        }
        return n;
      }
      case 'TypeOfExpression': {
        this.bindType(syntax.type, { allowUnbound: true });
        return this.node('TypeOf', syntax, this.core.type);
      }
      case 'SizeOfExpression': {
        const type = this.bindType(syntax.type).type;
        const n = this.node('SizeOf', syntax, this.core.int);
        const size = {
          sbyte: 1,
          byte: 1,
          bool: 1,
          short: 2,
          ushort: 2,
          char: 2,
          int: 4,
          uint: 4,
          float: 4,
          long: 8,
          ulong: 8,
          double: 8,
          decimal: 16,
        }[keywordOf(type)];
        if (size) n.constantValue = ConstantValue.int(size);
        return n;
      }
      case 'CheckedExpression':
      case 'UncheckedExpression': {
        const saved = [this.checked, this.uncheckedContext];
        this.checked = kind === 'CheckedExpression';
        this.uncheckedContext = !this.checked;
        try {
          const e = this.value(syntax.expression);
          return e.hasErrors ? e : { ...e, syntax };
        } finally {
          [this.checked, this.uncheckedContext] = saved;
        }
      }
      case 'InterpolatedStringExpression': {
        const parts = [];
        for (const content of syntax.contents)
          if (content.kind === 'Interpolation') {
            parts.push(this.value(content.expression));
            if (content.alignmentClause) this.convert(this.value(content.alignmentClause.value), this.core.int);
          }
        return this.node('InterpolatedString', syntax, this.core.string, { parts, form: 'interpolatedString' });
      }
      case 'AwaitExpression':
        return this.await(syntax);
      case 'ThrowExpression': {
        const e = this.value(syntax.expression);
        this.checkThrown(e, syntax.expression);
        return this.node('Throw', syntax, null, { operand: e, form: 'throw' });
      }
      case 'SimpleLambdaExpression':
      case 'ParenthesizedLambdaExpression':
      case 'AnonymousMethodExpression':
        return this.lambda(syntax);
      case 'TupleExpression':
        return this.tuple(syntax);
      case 'ConditionalAccessExpression':
        return this.conditionalAccess(syntax);
      case 'RefExpression': {
        const e = this.value(syntax.expression);
        return e.hasErrors ? e : this.node('Ref', syntax, e.type, { operand: e, isRef: true });
      }
      case 'DeclarationExpression':
        return this.declarationExpression(syntax, null);
      case 'SwitchExpression':
        return this.switchExpression(syntax);
      case 'CollectionExpression':
        return this.collectionExpression(syntax);
      case 'AnonymousObjectCreationExpression':
      case 'QueryExpression':
      case 'RangeExpression':
      case 'WithExpression':
      case 'StackAllocArrayCreationExpression':
      case 'ImplicitStackAllocArrayCreationExpression':
      case 'IndexExpression':
        // Bound by later epics (anonymous types, queries, ranges, records): operands are still bound for their own diagnostics.
        for (const child of syntax.childNodes())
          if (/Expression$|Name$/.test(child.kind) && kind !== 'QueryExpression' && kind !== 'AnonymousObjectCreationExpression')
            this.expression(child);
        return this.lenient(syntax);
      default:
        return this.lenient(syntax);
    }
  }
  typeArgumentsOf(syntax) {
    return syntax.kind === 'GenericName' ? syntax.typeArgumentList.arguments.map(a => this.bindType(a).type) : null;
  }
  get variableContext() {
    return {
      method: this.c.method,
      containingType: this.c.containingType,
      isFieldInitializer: this.c.isFieldInitializer,
      isStatic: this.c.isStatic,
      inObjectInitializer: this.inObjectInitializer,
    };
  }
  /** The best common type of a set of expressions (spec 12.6.3.15): the candidate type every expression converts to. */
  bestCommonType(values) {
    const candidates = [];
    for (const v of values)
      if (v.type && v.type.specialType !== 'System_Void' && !candidates.some(c => c.equals(v.type))) candidates.push(v.type);
    const best = candidates.filter(c =>
      values.every(v => {
        const r = this.conversions.classifyFromExpression(v, c);
        return r.exists && r.isImplicit;
      }),
    );
    if (best.length === 1) return best[0];
    if (best.length > 1) {
      const top = best.filter(c => best.every(o => o === c || this.conversions.classifyImplicit(o, c).exists));
      if (top.length === 1) return top[0];
    }
    return null;
  }
  operandDisplay(e) {
    return e.literal === 'null'
      ? '<null>'
      : e.kind === 'MethodGroup'
        ? 'method group'
        : e.form === 'lambda'
          ? 'lambda expression'
          : e.literal === 'default'
            ? 'default'
            : this.display(e.type);
  }
  operand(e, type) {
    if (!type || (!e.type && !e.literal)) return e;
    if (e.type && e.type.equals(type)) return e;
    const c = this.conversions.classifyFromExpression(e, type);
    return c.exists ? this.applyConversion(e, type, c) : e;
  }
  convertQuiet(e, type) {
    const c = this.conversions.classifyFromExpression(e, type);
    return c.exists ? this.applyConversion(e, type, c) : e;
  }
  /** Constant expression evaluation used by const fields, enum members, parameter defaults and case labels. */
  constant(syntax, type = null) {
    const e = this.value(syntax);
    if (e.hasErrors) return { errors: true, bound: e };
    const converted = type ? this.convert(e, type, syntax) : e;
    return { constant: converted.constantValue, type: converted.type, bound: converted, errors: !!converted.hasErrors };
  }
}
