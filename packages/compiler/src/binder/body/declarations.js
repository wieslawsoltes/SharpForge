/**
 * Local declarations: explicit and `var` typing, const, ref and scoped locals, using declarations and the
 * disposability check of `using` resources.
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { SymbolKind, TypeKind, RefKind, ErrorTypeSymbol, ArrayTypeSymbol } from '../../symbols/types.js';
import { LocalDeclarationKind } from '../../symbols/members.js';
import { implementsInterface } from '../../symbols/substitution.js';
import { checkRefLocalInitializer, checkRefWritability, recordRefLocal } from '../ref-locals.js';
import { checkAsyncOrIteratorUse } from '../ref-struct.js';
import { numericKind } from '../../conversions/numeric.js';
import { isAsyncDisposable } from '../async-streams.js';
import { reportAwaitOutsideAsync } from '../async.js';
import { untypedInitializerProblem } from '../implicit-types.js';
import { isWriteAUse } from '../../flow/write-is-a-use.js';

const unknown = ErrorTypeSymbol.unknown;
const isSourceType = t => {
  for (let s = t?.originalDefinition ?? t; s; s = s.containingSymbol) if (s.isSource) return true;
  return false;
};
const stmt = (kind, syntax, completes, props) => ({ kind, syntax, completes, ...props });

/** Class mixin: Local declarations: explicit and `var` typing, const, ref and scoped locals, using declarations and the */
export const DeclarationBinding = Base =>
  class extends Base {
    localDeclaration(syntax) {
      const modifiers = syntax.modifiers.map(m => m.text),
        isConst = modifiers.includes('const'),
        isUsing = !!syntax.usingKeyword;
      const d = this.variableDeclaration(syntax.declaration, {
        isConst,
        isUsing,
        isAwait: !!syntax.awaitKeyword,
        isScoped: modifiers.includes('scoped'),
      });
      if (syntax.awaitKeyword) reportAwaitOutsideAsync(this, syntax.awaitKeyword);
      return stmt('LocalDeclaration', syntax, true, { declarations: d, isUsing, isAwait: !!syntax.awaitKeyword });
    }
    /** `Type a = x, b = y` (locals, for-initializers, using and fixed declarations). */
    variableDeclaration(syntax, { isConst = false, isUsing = false, isAwait = false, isFixed = false, isScoped = false }) {
      let typeSyntax = syntax.type,
        isRef = false,
        isRefReadonly = false;
      if (typeSyntax.kind === 'ScopedType') {
        isScoped = true;
        typeSyntax = typeSyntax.type;
      }
      if (typeSyntax.kind === 'RefType') {
        isRef = true;
        isRefReadonly = !!typeSyntax.readOnlyKeyword;
        typeSyntax = typeSyntax.type;
      }
      const bound = this.bindType(typeSyntax, { allowVar: true }),
        isVar = !!bound.isVar,
        declaredType = isVar ? null : bound.type,
        results = [];
      if (isVar && syntax.variables.length > 1) this.report(syntax, DiagnosticId.CS0819);
      if (isVar && isConst) this.report(syntax, DiagnosticId.CS0822);
      if (declaredType && declaredType.isStatic) this.report(typeSyntax, DiagnosticId.CS0723, [this.display(declaredType)]);
      if (declaredType && !declaredType.isErrorType()) {
        const bad = checkAsyncOrIteratorUse(
          declaredType,
          'local',
          { isAsync: this.c.isAsync, isIterator: this.c.isIterator },
          this.version.number,
        );
        if (bad?.feature) this.d.gate(this.c.uri, typeSyntax, 'RefUnsafeInIteratorAsync', bad.feature);
        else if (bad) this.report(typeSyntax, bad.code, bad.args);
      }
      for (const v of syntax.variables) {
        const name = v.identifier.valueText,
          init = v.initializer?.value ?? null,
          kind = isConst
            ? LocalDeclarationKind.Constant
            : isUsing
              ? LocalDeclarationKind.Using
              : isFixed
                ? LocalDeclarationKind.Fixed
                : LocalDeclarationKind.Regular;
        const local = this.newLocal(name, declaredType ?? unknown, v.identifier, kind, {
          refKind: isRef ? (isRefReadonly ? RefKind.RefReadOnly : RefKind.Ref) : RefKind.None,
        });
        local.isScoped = isScoped;
        local.declaredAnnotation = isVar ? null : bound.nullableAnnotation;
        let value = null;
        if (isVar) {
          // `var x = x;` cannot see x: the initializer is bound before the local enters scope.
          this.pending.at(-1).add(name);
          if (!init) {
            this.report(v.identifier, DiagnosticId.CS0818);
            this.declare(name, local, v.identifier);
            results.push({ local, value: null });
            continue;
          }
          if (init.kind === 'ArrayInitializerExpression') {
            this.report(v, DiagnosticId.CS0820);
            // The local counts as assigned: Roslyn reports the initializer, not an unused variable.
            local.writes++;
            this.declare(name, local, v.identifier);
            results.push({ local, value: null });
            continue;
          }
          value = this.value(isRef && init.kind === 'RefExpression' ? init.expression : init);
          this.declare(name, local, v.identifier);
          if (!value.hasErrors) {
            const typed = this.implicitLocalType(value, init, v);
            value = typed.value;
            local.setType(typed.type ?? unknown);
          }
        } else {
          this.declare(name, local, v.identifier);
          if (init) {
            if (init.kind === 'ArrayInitializerExpression') {
              if (declaredType instanceof ArrayTypeSymbol)
                value = this.node('ArrayCreation', init, declaredType, {
                  elements: this.arrayInitializer(init, declaredType.elementType, declaredType.rank),
                });
              else {
                if (!declaredType.isErrorType()) this.report(init, DiagnosticId.CS0622);
                value = this.bad(init);
              }
            } else {
              const raw = this.value(isRef && init.kind === 'RefExpression' ? init.expression : init);
              if (isRef) {
                value = this.markAliased(raw);
                if (!raw.hasErrors && raw.type && !raw.type.equals(declaredType) && !declaredType.isErrorType())
                  this.report(init, DiagnosticId.CS8173, [this.display(declaredType)]);
              } else {
                value = this.convert(raw, declaredType, init);
                if (raw.form === 'lambda' && !value.hasErrors) this.finishLambda(raw, declaredType);
              }
            }
          } else if (isConst) this.report(v.identifier, DiagnosticId.CS0145);
        }
        if (init || isRef) {
          const r = checkRefLocalInitializer(
            isRef,
            init?.kind === 'RefExpression',
            value && !value.hasErrors ? value : null,
            this.variableContext,
          );
          if (r && !value?.hasErrors) this.report(r.code === DiagnosticId.CS8174 ? v.identifier : (init ?? v), r.code, r.args);
          else if (isRef && value && !value.hasErrors) {
            const w = checkRefWritability(value, isRefReadonly, this.variableContext);
            if (w) this.report(init, w.code, w.args);
            recordRefLocal(local, value, this.variableContext);
          }
        }
        if (init) {
          local.writes++;
          local.hasInitializer = true;
          if (value && isWriteAUse(local.type, value)) local.nonConstantWrite = true;
          if (isUsing || isFixed) local.nonConstantWrite = true;
        }
        if (isConst && value && !value.hasErrors) {
          const t = local.type,
            cannotBeConst =
              t &&
              !t.isErrorType() &&
              !(
                numericKind(t) ||
                ['System_Boolean', 'System_String', 'System_Char'].includes(t.specialType) ||
                t.typeKind === TypeKind.Enum ||
                t.isReferenceType === true
              );
          // A type that cannot be const is reported alone: its initializer is not asked to be constant.
          // A const of a reference type other than string can only be null (the rule fields have in semantic/constants.js).
          const onlyNull = t?.isReferenceType === true && t.specialType !== 'System_String' && !t.isErrorType(),
            written = value.constantValue ?? value.operand?.constantValue ?? null;
          if (cannotBeConst) this.report(typeSyntax, DiagnosticId.CS0283, [this.display(t)]);
          else if (onlyNull && written && !written.isNull) this.report(init, DiagnosticId.CS0134, [name, this.display(t)]);
          else if (!value.constantValue) this.report(init, DiagnosticId.CS0133, [name]);
          if (value.constantValue) {
            local.constantValueObject = value.constantValue;
            local.hasConstantValue = true;
          }
        }
        if (isUsing && local.type && !local.type.isErrorType()) this.checkDisposable(local.type, syntax, isAwait, value);
        results.push({ local, value });
      }
      return results;
    }
    /**
     * The type of `var x = value` and the value converted to it: `{ value, type }`, with `type` null (and the
     * diagnostic reported) when the initializer cannot give the local a type.
     */
    implicitLocalType(value, init, declarator) {
      if (value.noNaturalType) {
        this.report(init, DiagnosticId.CS0173, [this.operandDisplay(value.noNaturalType.left), this.operandDisplay(value.noNaturalType.right)]);
        return { value: this.bad(init), type: null };
      }
      if (value.isTargetTypedSwitch) {
        this.report(init.switchKeyword ?? init, DiagnosticId.CS8506);
        return { value: this.bad(init), type: null };
      }
      if (value.form === 'lambda' || value.kind === 'MethodGroup') return this.inferredDelegateLocal(value, init);
      if (!value.type) {
        const problem = untypedInitializerProblem(value);
        this.report(problem.at === 'initializer' ? init : declarator, problem.code, problem.args);
        return { value, type: null };
      }
      if (value.type.specialType === 'System_Void') {
        this.report(declarator, DiagnosticId.CS0815, ['void']);
        return { value, type: null };
      }
      return { value, type: value.type };
    }
    /** C# 10: a lambda or method group initializer gives `var` its natural delegate type; CS8917 when it has none. */
    inferredDelegateLocal(value, init) {
      if (!this.d.gate(this.c.uri, init, 'inferredDelegateType')) return { value, type: null };
      const natural = this.naturalFunctionType(value);
      if (!natural) {
        this.report(init, DiagnosticId.CS8917);
        return { value, type: null };
      }
      const converted = this.convert(value, natural, init);
      if (value.form === 'lambda' && !converted.hasErrors) this.finishLambda(value, natural);
      return { value: converted, type: natural };
    }
    /** The natural delegate type of a lambda or of a method group with exactly one non-generic method, or null. */
    naturalFunctionType(value) {
      if (value.form === 'lambda') return value.naturalType();
      return value.methods.length === 1 && !value.methods[0].arity ? this.naturalGroupType(value) : null;
    }
    /** A `using` resource must convert to IDisposable (IAsyncDisposable for await using); ../csharp8.js adds pattern-based disposal. */
    checkDisposable(type, node, isAwait, value) {
      if (!type || type.isErrorType?.() || value?.hasErrors || value?.literal === 'null') return;
      if (isAwait ? isAsyncDisposable(type, this.core, this.c.containingType) : implementsInterface(type, this.core.idisposable, this.core)) return;
      if (type.typeKind === TypeKind.TypeParameter && type.constraintTypes.length) return;
      // A dynamic resource is converted to IDisposable at run time.
      if (type.typeKind === TypeKind.Dynamic) return;
      // Registry types do not list their interfaces completely: only source types and primitives are known not to be disposable.
      if (
        !isSourceType(type) &&
        !numericKind(type) &&
        !['System_Boolean', 'System_String', 'System_Object', 'System_Char'].includes(type.specialType) &&
        !(type instanceof ArrayTypeSymbol) &&
        type.typeKind !== TypeKind.Enum
      ) {
        this.incomplete = this.d.incomplete = true;
        return;
      }
      const syncCode = isAsyncDisposable(type, this.core, this.c.containingType) ? DiagnosticId.CS8418 : DiagnosticId.CS1674;
      this.report(node, isAwait ? DiagnosticId.CS8410 : syncCode, [this.display(type)]);
    }
  };
