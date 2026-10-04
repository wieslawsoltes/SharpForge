import {bindArgumentHandle, bindTypedReferenceExpression} from './varargs.js';
/**
 * The core of the body binder: scopes and locals, diagnostics, conversions of bound expressions and the
 * expression dispatcher. The expression and statement families are class mixins composed in ../body-binder.js.
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { TypeKind, ErrorTypeSymbol } from '../../symbols/types.js';
import { LocalSymbol, LocalDeclarationKind } from '../../symbols/members.js';
import { ConstantValue } from '../../constants/constant-value.js';
import { literalConstant } from '../../constants/literal-value.js';
import { defaultConstant } from '../../constants/default-constant.js';
import { numericKind } from '../../conversions/numeric.js';
import { isNullableType } from '../../conversions/nullable.js';

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
   * @param context `{uri,scope,containingType,method,isStatic,returnType,returnRefKind,isAsync,isIterator,isFieldInitializer,parent,outerLocals}`
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
    for (const p of context.parameters ?? context.method?.parameters ?? []) if (p.name && !p.isDiscard) this.scopes[0].set(p.name, p);
    // Expression variables of a constructor initializer are in scope in the constructor body.
    for (const [name, symbol] of context.outerLocals ?? []) this.scopes[0].set(name, symbol);
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
  /** True when a local of this name is declared later in an enclosing scope, also of an enclosing function. */
  isPending(name) {
    for (let b = this; b; b = b.c.parent) for (let i = b.pending.length - 1; i >= 0; i--) if (b.pending[i].has(name)) return true;
    return false;
  }
  declare(name, symbol, node) {
    const current = this.scopes.at(-1);
    if (current.has(name)) {
      this.report(node, DiagnosticId.CS0128, [name]);
      return symbol;
    }
    for (let b = this; b; b = b.c.parent) {
      const from = b === this ? this.scopes.length - 2 : b.scopes.length - 1;
      for (let i = from; i >= 0; i--)
        if (b.scopes[i].has(name)) {
          this.report(node, DiagnosticId.CS0136, [name]);
          current.set(name, symbol);
          return symbol;
        }
    }
    // A name declared later in an enclosing scope also conflicts (the outer local's scope is its whole block).
    for (let i = this.pending.length - 2; i >= 0; i--)
      if (this.pending[i].has(name)) {
        this.report(node, DiagnosticId.CS0136, [name]);
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
          constant = literalConstant(v);
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
      case 'AliasQualifiedName':
        return this.aliasQualifiedName(syntax);
      case 'PredefinedType':
        return this.node('TypeExpression', syntax, null, { referencedType: this.core.keyword(syntax.keyword.text) ?? unknown });
      case 'ThisExpression': {
        if (this.c.isStatic || !this.c.containingType) {
          this.report(syntax, this.c.isFieldInitializer && !this.c.isStaticInitializer ? DiagnosticId.CS0027 : DiagnosticId.CS0026);
          return this.bad(syntax);
        }
        if (this.c.isFieldInitializer) {
          this.report(syntax, DiagnosticId.CS0027);
          return this.bad(syntax);
        }
        return this.node('This', syntax, this.c.containingType);
      }
      case 'BaseExpression': {
        if (this.c.isStatic || !this.c.containingType) {
          this.report(syntax, DiagnosticId.CS1511);
          return this.bad(syntax);
        }
        const base = this.c.containingType.baseType;
        if (!base) return this.bad(syntax);
        return this.node('Base', syntax, base, { isBase: true });
      }
      case 'SimpleMemberAccessExpression':
        return this.memberAccess(syntax, options);
      case 'ArgListExpression': return bindArgumentHandle(this, syntax);
      case 'MakeRefExpression': case 'RefTypeExpression': case 'RefValueExpression':
        return bindTypedReferenceExpression(this, syntax);
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
        n.constantValue = defaultConstant(type);
        return n;
      }
      case 'TypeOfExpression': {
        const operandType = this.bindType(syntax.type, { allowUnbound: true })?.type ?? null;
        return this.node('TypeOf', syntax, this.core.type, { operandType });
      }
      case 'SizeOfExpression': {
        const type = this.bindType(syntax.type).type;
        const n = this.node('SizeOf', syntax, this.core.int, { operandType: type });
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
          // An enum has the size of its underlying type; `sizeof(E)` is a constant like `sizeof(int)`.
        }[keywordOf(type.typeKind === TypeKind.Enum ? (type.enumUnderlyingType ?? this.core.int) : type)];
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
      case 'InterpolatedStringExpression':
        return this.interpolatedString(syntax);
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
        return e.hasErrors ? e : this.node('Ref', syntax, e.type, { operand: this.markAliased(e), isRef: true });
      }
      case 'DeclarationExpression':
        return this.declarationExpression(syntax, null);
      case 'SwitchExpression':
        return this.switchExpression(syntax);
      case 'CollectionExpression':
        return this.collectionExpression(syntax);
      case 'StackAllocArrayCreationExpression':
      case 'ImplicitStackAllocArrayCreationExpression':
        return this.stackAlloc(syntax);
      case 'WithExpression':
        return this.withExpression(syntax);
      case 'AnonymousObjectCreationExpression':
        return this.anonymousObjectCreation(syntax);
      case 'QueryExpression':
      case 'RangeExpression':
      case 'IndexExpression':
        // Bound by later epics (queries, ranges): operands are still bound for their own diagnostics.
        for (const child of syntax.childNodes())
          if (/Expression$|Name$/.test(child.kind) && kind !== 'QueryExpression')
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
      isLambda: !!this.c.isLambda,
    };
  }
}
