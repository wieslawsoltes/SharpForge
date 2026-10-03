/**
 * C# 8 rules of statements and nested functions (SF-A02-T68).
 *
 * Static local functions (C# 8) and static anonymous functions (C# 9) capture no state: a reference to a local,
 * a parameter or a non-static local function of an enclosing function is CS8421 (CS8820 in an anonymous function),
 * a reference to `this` or `base` - written or implied by an instance member - is CS8422 (CS8821). Constants,
 * static members, type parameters and names inside `nameof` are not captures.
 *
 * Using declarations: every declarator needs an initializer (CS0210), a using declaration cannot stand directly in
 * a switch section (CS8647), and a `goto` cannot jump forward over a using declaration of an enclosing block
 * (CS8648) or back to a label that precedes one in the same block (CS8649).
 *
 * Pattern-based disposal: a ref struct cannot implement IDisposable before C# 13, so `using` accepts an accessible
 * instance `void Dispose()` on it; the form is gated as 'pattern-based disposal' below C# 8.
 *
 * `a ?? b` whose left operand is an unconstrained type parameter is gated below C# 8.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, TypeParameterSymbol } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { implementsInterface } from '../symbols/substitution.js';
import { lookupMembers } from './inheritance.js';
import { isRefLike } from './ref-struct.js';

/** The diagnostics of a capture, by the kind of static function that contains it. */
const captureCodes = Object.freeze({
  localFunction: { variable: DiagnosticId.CS8421, instance: DiagnosticId.CS8422 },
  lambda: { variable: DiagnosticId.CS8820, instance: DiagnosticId.CS8821 },
});

/** True when one of the binder's scopes declares exactly this symbol. */
const declares = (binder, symbol) => binder.scopes.some(scope => scope.get(symbol.name) === symbol);

/** The static function ('localFunction' or 'lambda') between a use in `binder` and the declaration of `symbol`, or null. */
function staticFunctionCrossedTo(binder, symbol) {
  for (let current = binder; current; current = current.c.parent) {
    if (declares(current, symbol)) return null;
    if (current.c.staticFunction) return current.c.staticFunction;
  }
  return null;
}

/** The innermost static function around `binder`, or null. */
function enclosingStaticFunction(binder) {
  for (let current = binder; current; current = current.c.parent) if (current.c.staticFunction) return current.c.staticFunction;
  return null;
}

/** The accessible instance `void Dispose()` a `using` calls on a value of `type` by pattern, or null. */
export function patternDisposeMethod(type, core, within) {
  const candidates = lookupMembers(type, 'Dispose', core, { within }).members;
  return (
    candidates.find(
      member =>
        member.kind === SymbolKind.Method &&
        !member.isStatic &&
        !member.arity &&
        member.returnsVoid &&
        member.parameters.every(parameter => parameter.isOptional || parameter.isParams),
    ) ?? null
  );
}

/** The start offsets of the variables declared by the using declarations directly in a statement list. */
function usingDeclarationStarts(statements) {
  const starts = [];
  for (const statement of statements) {
    if (statement.kind !== 'LocalDeclarationStatement' || !statement.usingKeyword) continue;
    for (const variable of statement.declaration.variables) starts.push(variable.identifier.span.start);
  }
  return starts;
}

/** Class mixin: static function captures, using declaration rules and pattern-based disposal. */
export const CSharp8Binding = Base =>
  class extends Base {
    // ---- static local and anonymous functions ----
    node(kind, syntax, type, props) {
      switch (kind) {
        case 'Local':
          if (!props.local.isConst) this.checkStaticCapture(props.local, syntax);
          break;
        case 'Parameter':
          this.checkStaticCapture(props.parameter, syntax);
          break;
        case 'MethodGroup': {
          const method = props.methods?.length === 1 ? props.methods[0] : null;
          if (method?.methodKind === MethodKind.LocalFunction && !method.isStatic) {
            // Roslyn reports a call on the whole invocation and a method group conversion on the name.
            const invocation = syntax.parent?.kind === 'InvocationExpression' && syntax.parent.expression === syntax ? syntax.parent : null;
            this.checkStaticCapture(method, invocation ?? syntax);
          }
          break;
        }
        case 'This':
        case 'Base': {
          const container = enclosingStaticFunction(this);
          if (container) this.report(syntax, captureCodes[container].instance);
          break;
        }
        default:
      }
      return super.node(kind, syntax, type, props);
    }
    checkStaticCapture(symbol, syntax) {
      if (!this.c.parent) return;
      const container = staticFunctionCrossedTo(this, symbol);
      if (container) this.report(syntax, captureCodes[container].variable, [symbol.name]);
    }
    // ---- using declarations ----
    block(syntax, options = {}) {
      const record = { usingStarts: usingDeclarationStarts(options.statements ?? syntax.statements) };
      (this.openBlocks ??= []).push(record);
      try {
        return super.block(syntax, options);
      } finally {
        this.openBlocks.pop();
      }
    }
    declareLabel(syntax) {
      (this.labelBlocks ??= new Map()).set(syntax, this.openBlocks.at(-1));
      return super.declareLabel(syntax);
    }
    gotoLabel(syntax) {
      const bound = super.gotoLabel(syntax);
      if (bound.label) this.checkJumpOverUsing(syntax, bound.label);
      return bound;
    }
    /** CS8648 and CS8649: the using declarations in scope at a goto are those of its enclosing blocks. */
    checkJumpOverUsing(syntax, label) {
      const source = syntax.span.start,
        target = label.syntax.span.start,
        labelBlock = this.labelBlocks?.get(label.syntax);
      for (const block of this.openBlocks ?? []) {
        for (const start of block.usingStarts) {
          if (source < start && target > start) {
            this.report(syntax, DiagnosticId.CS8648);
            return;
          }
          if (source > start && target < start && labelBlock === block) {
            this.report(syntax, DiagnosticId.CS8649);
            return;
          }
        }
      }
    }
    localDeclaration(syntax) {
      if (syntax.usingKeyword && syntax.parent?.kind === 'SwitchSection') this.report(syntax, DiagnosticId.CS8647);
      return super.localDeclaration(syntax);
    }
    variableDeclaration(syntax, options) {
      if (options.isUsing) for (const variable of syntax.variables) if (!variable.initializer) this.report(variable.identifier, DiagnosticId.CS0210);
      return super.variableDeclaration(syntax, options);
    }
    // ---- null coalescing ----
    /** `a ?? b` over a type parameter that is not known to be a reference or a value type is a C# 8 form. */
    coalesce(syntax) {
      const bound = super.coalesce(syntax),
        type = bound.hasErrors ? null : bound.left?.type;
      if (type instanceof TypeParameterSymbol && type.isReferenceType !== true && type.isValueType !== true)
        this.d.gate(this.c.uri, syntax, 'UnconstrainedTypeParameterInNullCoalescingOperator');
      return bound;
    }
    // ---- disposal ----
    checkDisposable(type, node, isAwait, value) {
      if (!type || type.isErrorType?.() || value?.hasErrors) return;
      if (!isAwait && isRefLike(type) && !implementsInterface(type, this.core.idisposable, this.core)) {
        if (patternDisposeMethod(type, this.core, this.c.containingType)) {
          this.d.gate(this.c.uri, node, 'DisposalPattern');
          return;
        }
      }
      // A using declaration is reported on the whole statement, a using statement on its declaration or expression.
      const isDeclarationStatement = node.kind === 'VariableDeclaration' && node.parent?.kind === 'LocalDeclarationStatement';
      super.checkDisposable(type, isDeclarationStatement ? node.parent : node, isAwait, value);
    }
  };
