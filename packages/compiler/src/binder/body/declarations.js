/**
 * Local declarations: explicit and `var` typing, const, ref and scoped locals, using declarations and the
 * disposability check of `using` resources.
 */
import { SymbolKind, TypeKind, RefKind, ErrorTypeSymbol, ArrayTypeSymbol } from '../../symbols/types.js';
import { LocalDeclarationKind } from '../../symbols/members.js';
import { implementsInterface } from '../../symbols/substitution.js';
import { checkRefLocalInitializer, checkRefWritability, recordRefLocal } from '../ref-locals.js';
import { checkAsyncOrIteratorUse, checkArrayElementType } from '../ref-struct.js';
import { numericKind } from '../../conversions/numeric.js';
import { isAsyncDisposable } from '../async-streams.js';
import { reportAwaitOutsideAsync } from '../async.js';

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
      if (isVar && syntax.variables.length > 1) this.report(syntax, 'CS0819');
      if (declaredType && declaredType.isStatic) this.report(typeSyntax, 'CS0723', [this.display(declaredType)]);
      if (declaredType && !declaredType.isErrorType()) {
        const bad = checkAsyncOrIteratorUse(
          declaredType,
          'local',
          { isAsync: this.c.isAsync, isIterator: this.c.isIterator },
          this.version.number,
        );
        if (bad) this.report(typeSyntax, bad.code, bad.args);
        if (declaredType instanceof ArrayTypeSymbol) {
          const e = checkArrayElementType(declaredType.elementType);
          if (e) this.report(typeSyntax, e.code, e.args);
        }
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
            this.report(v.identifier, 'CS0818');
            this.declare(name, local, v.identifier);
            results.push({ local, value: null });
            continue;
          }
          if (init.kind === 'ArrayInitializerExpression') {
            this.report(v.identifier, 'CS0820');
            this.declare(name, local, v.identifier);
            results.push({ local, value: null });
            continue;
          }
          value = this.value(isRef && init.kind === 'RefExpression' ? init.expression : init);
          this.declare(name, local, v.identifier);
          if (!value.hasErrors) {
            let type = value.type;
            if (value.noNaturalType) {
              this.report(init, 'CS0173', [this.operandDisplay(value.noNaturalType.left), this.operandDisplay(value.noNaturalType.right)]);
              type = null;
              value = this.bad(init);
            } else if (value.isTargetTypedSwitch) {
              this.report(init.switchKeyword ?? init, 'CS8506');
              type = null;
              value = this.bad(init);
            } else if (value.form === 'lambda' || value.kind === 'MethodGroup') {
              // C# 10: lambdas and method groups have a natural delegate type when it can be inferred.
              const natural =
                this.version.number >= 10
                  ? value.form === 'lambda'
                    ? value.naturalType()
                    : value.methods.length === 1 && !value.methods[0].arity
                      ? this.naturalGroupType(value)
                      : null
                  : null;
              if (natural) {
                const lambda = value;
                value = this.convert(value, natural, init);
                if (lambda.form === 'lambda' && !value.hasErrors) this.finishLambda(lambda, natural);
                type = natural;
              } else {
                this.report(
                  v,
                  this.version.number >= 10 ? (value.form === 'lambda' ? 'CS8917' : 'CS8917') : 'CS0815',
                  this.version.number >= 10
                    ? []
                    : [value.form === 'lambda' ? (value.isAnonymousMethod ? 'anonymous method' : 'lambda expression') : 'method group'],
                );
                type = null;
              }
            } else if (!type) {
              if (value.form === 'collection') this.report(init, 'CS9176');
              else if (value.form === 'implicitNew') this.report(init, 'CS8754', ['new()']);
              else
                this.report(v, 'CS0815', [
                  value.literal === 'null' ? '<null>' : value.literal === 'default' ? 'default' : value.kind === 'Tuple' ? '(...)' : '?',
                ]);
            } else if (type.specialType === 'System_Void') {
              this.report(v, 'CS0815', ['void']);
              type = null;
            }
            local.setType(type ?? unknown);
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
                if (!declaredType.isErrorType()) this.report(init, 'CS0622');
                value = this.bad(init);
              }
            } else {
              const raw = this.value(isRef && init.kind === 'RefExpression' ? init.expression : init);
              if (isRef) {
                value = this.markAliased(raw);
                if (!raw.hasErrors && raw.type && !raw.type.equals(declaredType) && !declaredType.isErrorType())
                  this.report(init, 'CS8173', [this.display(declaredType)]);
              } else {
                value = this.convert(raw, declaredType, init);
                if (raw.form === 'lambda' && !value.hasErrors) this.finishLambda(raw, declaredType);
              }
            }
          } else if (isConst) this.report(v.identifier, 'CS0145');
        }
        if (init || isRef) {
          const r = checkRefLocalInitializer(
            isRef,
            init?.kind === 'RefExpression',
            value && !value.hasErrors ? value : null,
            this.variableContext,
          );
          if (r && !value?.hasErrors) this.report(r.code === 'CS8174' ? v.identifier : (init ?? v), r.code, r.args);
          else if (isRef && value && !value.hasErrors) {
            const w = checkRefWritability(value, isRefReadonly, this.variableContext);
            if (w) this.report(init, w.code, w.args);
            recordRefLocal(local, value, this.variableContext);
          }
        }
        if (init) {
          local.writes++;
          local.hasInitializer = true;
          if (value && !(value.constantValue || value.literal || value.kind === 'Default')) local.nonConstantWrite = true;
          if (isUsing || isFixed) local.nonConstantWrite = true;
        }
        if (isConst && value && !value.hasErrors) {
          const t = local.type;
          if (!value.constantValue) {
            this.report(init, 'CS0133', [name]);
          } else {
            local.constantValueObject = value.constantValue;
            local.hasConstantValue = true;
          }
          if (
            t &&
            !t.isErrorType() &&
            !(
              numericKind(t) ||
              ['System_Boolean', 'System_String', 'System_Char'].includes(t.specialType) ||
              t.typeKind === TypeKind.Enum ||
              t.isReferenceType === true
            )
          )
            this.report(typeSyntax, 'CS0283', [this.display(t)]);
        }
        if (isUsing && local.type && !local.type.isErrorType()) this.checkDisposable(local.type, syntax, isAwait, value);
        results.push({ local, value });
      }
      return results;
    }
    naturalGroupType(group) {
      const m = group.methods[0];
      if (m.parameters.some(p => p.refKind !== RefKind.None) || m.parameters.length > 4) return null;
      const types = m.parameters.map(p => p.type);
      return m.returnsVoid
        ? types.length
          ? this.core.action(types.length).construct(types)
          : this.core.action(0)
        : types.length > 4
          ? null
          : this.core.func(types.length + 1).construct([...types, m.returnType]);
    }
    /** A `using` resource must convert to IDisposable (IAsyncDisposable for await using); ../csharp8.js adds pattern-based disposal. */
    checkDisposable(type, node, isAwait, value) {
      if (!type || type.isErrorType?.() || value?.hasErrors || value?.literal === 'null') return;
      if (isAwait ? isAsyncDisposable(type, this.core) : implementsInterface(type, this.core.idisposable, this.core)) return;
      if (type.typeKind === TypeKind.TypeParameter && type.constraintTypes.length) return;
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
      const syncCode = isAsyncDisposable(type, this.core) ? 'CS8418' : 'CS1674';
      this.report(node, isAwait ? 'CS8410' : syncCode, [this.display(type)]);
    }
  };
