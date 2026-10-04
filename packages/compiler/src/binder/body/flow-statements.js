/**
 * foreach over every enumeration pattern, switch statements with patterns and return.
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { SymbolKind, TypeKind, RefKind, ErrorTypeSymbol, ArrayTypeSymbol } from '../../symbols/types.js';
import { LocalDeclarationKind } from '../../symbols/members.js';
import { lookupMembers } from '../inheritance.js';
import { findConstruction, implementsInterface } from '../../symbols/substitution.js';
import { checkRefReturn } from '../ref-locals.js';
import { numericKind } from '../../conversions/numeric.js';
import { reportAwaitOutsideAsync } from '../async.js';
import { bindAsyncForEach, isOnlyAsyncEnumerable } from '../async-streams.js';
import { extensionEnumeratorMethod } from '../foreach-extension.js';
import { inlineArrayShape } from '../inline-arrays.js';

const unknown = ErrorTypeSymbol.unknown;
/** `Span<T>` and `ReadOnlySpan<T>` enumerate their elements (their enumerator is a ref struct the registry bridge does not declare). */
const isSpanType = (type, core) => type.originalDefinition === core.span || type.originalDefinition === core.readOnlySpan;
const isSourceType = t => {
  for (let s = t?.originalDefinition ?? t; s; s = s.containingSymbol) if (s.isSource) return true;
  return false;
};
const stmt = (kind, syntax, completes, props) => ({ kind, syntax, completes, ...props });

/** Class mixin: foreach over every enumeration pattern, switch statements with patterns and return. */
export const FlowStatementBinding = Base =>
  class extends Base {
    forEach(syntax) {
      const collection = this.value(syntax.expression);
      this.pushScope();
      try {
        let element = null,
          enumeration = null,
          extension = null,
          // How `Current` yields the element: by value, or by reference (`foreach (ref var x in ...)` needs one).
          currentRefKind = RefKind.None;
        const type = collection.type;
        if (syntax.awaitKeyword) reportAwaitOutsideAsync(this, syntax.awaitKeyword);
        if (!collection.hasErrors && type && !type.isErrorType()) {
          if (type.typeKind === TypeKind.Dynamic) {
            // The enumerator is found at run time; an asynchronous one cannot be.
            if (syntax.awaitKeyword) this.report(syntax.expression, DiagnosticId.CS8416);
            element = syntax.awaitKeyword ? unknown : type;
          } else if (syntax.awaitKeyword) {
            enumeration = bindAsyncForEach(this, collection, syntax.expression);
            element = enumeration?.elementType ?? unknown;
          } else if (type instanceof ArrayTypeSymbol) element = type.elementType;
          else if (type.specialType === 'System_String') element = this.core.char;
          else if (isSpanType(type, this.core)) {
            element = type.typeArguments[0].type;
            currentRefKind = type.originalDefinition === this.core.span ? RefKind.Ref : RefKind.RefReadOnly;
          }
          else {
            const getEnumerator = lookupMembers(type, 'GetEnumerator', this.core, { within: this.c.containingType }).members.find(
              m => m.kind === SymbolKind.Method && !m.isStatic && !m.parameters.length && m.declaredAccessibility === 'public',
            );
            if (getEnumerator && getEnumerator.returnType && !getEnumerator.returnType.isErrorType()) {
              const current = lookupMembers(getEnumerator.returnType, 'Current', this.core, { within: this.c.containingType }).members.find(
                m => m.kind === SymbolKind.Property,
              );
              if (current) {
                element = current.type;
                currentRefKind = current.refKind ?? RefKind.None;
              } else {
                const generic = findConstruction(getEnumerator.returnType, this.core.ienumeratorT, this.core);
                element = generic ? generic.typeArguments[0].type : isSourceType(getEnumerator.returnType) ? null : unknown;
                if (!element) {
                  this.report(syntax.expression, DiagnosticId.CS0117, [this.display(getEnumerator.returnType), 'Current']);
                  element = unknown;
                }
              }
            } else {
              const generic = findConstruction(type, this.core.ienumerableT, this.core);
              if (generic) element = generic.typeArguments[0].type;
              else if (implementsInterface(type, this.core.ienumerable, this.core)) element = this.core.object;
              else if (inlineArrayShape(type)) {
                // C# 12: the elements of an inline array.
                this.d.gate(this.c.uri, syntax.expression, 'InlineArrays');
                element = inlineArrayShape(type).elementType;
              } else if ((extension = extensionEnumeratorMethod(this, collection, 'GetEnumerator'))) {
                // C# 9: the enumerator comes from an extension method; its result supplies MoveNext and Current.
                this.d.gate(this.c.uri, syntax.expression, 'ExtensionGetEnumerator');
                const current = lookupMembers(extension.returnType, 'Current', this.core, { within: this.c.containingType }).members.find(
                  m => m.kind === SymbolKind.Property,
                );
                element = current?.type ?? unknown;
                currentRefKind = current?.refKind ?? RefKind.None;
              } else if (isOnlyAsyncEnumerable(type, this.core, this.c.containingType)) {
                this.report(syntax.expression, DiagnosticId.CS8414, [this.display(type), 'GetEnumerator']);
                element = unknown;
              } else if (
                !isSourceType(type) &&
                type.typeKind !== TypeKind.TypeParameter &&
                !numericKind(type) &&
                !['System_Boolean', 'System_Object', 'System_Char'].includes(type.specialType) &&
                type.typeKind !== TypeKind.Enum
              ) {
                element = unknown;
                this.incomplete = this.d.incomplete = true;
              } else {
                this.report(syntax.expression, DiagnosticId.CS1579, [this.display(type), 'GetEnumerator']);
                element = unknown;
              }
            }
          }
        } else if (!collection.hasErrors && !type) {
          this.report(syntax.expression, DiagnosticId.CS0186);
        }
        element ??= unknown;
        // `foreach (var (a, b) in items)`: each element is deconstructed into the variables (binder/body/deconstruction.js).
        if (syntax.kind === 'ForEachVariableStatement')
          return this.forEachDeconstruction(syntax, { collection, elementType: element, enumeration, extensionGetEnumerator: extension });
        const bound = this.bindType(syntax.type.kind === 'RefType' ? syntax.type.type : syntax.type, { allowVar: true }),
          iterationType = bound.isVar ? element : bound.type;
        if (!bound.isVar && !element.isErrorType() && !iterationType.isErrorType()) {
          const c = this.conversions.classifyExplicit(element, iterationType);
          if (!c.exists) this.report(syntax.forEachKeyword, DiagnosticId.CS0030, [this.display(element), this.display(iterationType)]);
        }
        const name = syntax.identifier.valueText,
          local = this.newLocal(name, iterationType, syntax.identifier, LocalDeclarationKind.Foreach);
        local.writes++;
        local.nonConstantWrite = true;
        local.reads++;
        this.refIterationVariable(syntax, local, currentRefKind, !collection.hasErrors && !element.isErrorType());
        this.declare(name, local, syntax.identifier);
        const loop = this.enterLoop(),
          body = this.embedded(syntax.statement);
        this.exitLoop();
        return stmt('ForEach', syntax, true, {
          collection,
          local,
          elementType: element,
          body,
          isAwait: !!syntax.awaitKeyword,
          enumeration,
          extensionGetEnumerator: extension,
        });
      } finally {
        this.popScope();
      }
    }
    /**
     * `foreach (ref var x in e)` / `foreach (ref readonly var x in e)` (C# 7.3): the iteration variable is a
     * reference to the element `Current` returns. CS1510 when `Current` returns a value; CS8331 when the variable
     * is writable and `Current` returns a read-only reference.
     */
    refIterationVariable(syntax, local, currentRefKind, isEnumerable) {
      if (syntax.type.kind !== 'RefType') return;
      local.refKind = syntax.type.readOnlyKeyword ? RefKind.RefReadOnly : RefKind.Ref;
      if (!isEnumerable) return;
      if (currentRefKind === RefKind.None) this.report(syntax.expression, DiagnosticId.CS1510);
      else if (local.refKind === RefKind.Ref && currentRefKind === RefKind.RefReadOnly) {
        this.report(syntax.expression, DiagnosticId.CS8331, ['property', 'Current']);
      }
    }
    switchStatement(syntax) {
      const governing = this.value(syntax.expression),
        sw = Object.assign(this.enterLoop(false), { syntax, governing }),
        sections = [],
        seen = new Map();
      let hasDefault = false,
        anyCompletes = false;
      this.pushScope();
      this.enterLabels([]);
      try {
        const type = governing.hasErrors ? null : governing.type;
        if (type?.specialType === 'System_Boolean') this.d.gate(this.c.uri, syntax.expression, 'SwitchOnBool');
        // The sections of a switch are one declaration space: a local of one section is in scope in the others.
        // Pattern variables of the labels belong to their section and are removed from the scope when it ends.
        const switchScope = this.scopes.at(-1);
        for (const section of syntax.sections) for (const name of this.namesDeclaredIn(section.statements)) this.pending.at(-1).add(name);
        syntax.sections.forEach((section, index) => {
          const labels = [],
            shared = new Set(switchScope.keys());
          for (const label of section.labels) {
            if (label.kind === 'DefaultSwitchLabel') {
              if (hasDefault) this.report(label, DiagnosticId.CS0152, ['default']);
              hasDefault = true;
              labels.push({ kind: 'default' });
              continue;
            }
            if (label.kind === 'CaseSwitchLabel') {
              // A case label that names a type is a type pattern (C# 9).
              const p = this.pattern({ kind: 'ConstantPattern', expression: label.value, span: label.value.span }, type, governing);
              if (p.kind === 'ConstantPattern' && p.value?.constantValue) {
                const key = p.value.constantValue.toString();
                if (seen.has(key))
                  this.report(label, DiagnosticId.CS0152, [
                    p.value.constantValue.isNull
                      ? 'null'
                      : p.value.constantValue.type === 'string'
                        ? p.value.constantValue.value
                        : p.value.constantValue.displayValue,
                  ]);
                else seen.set(key, label);
              }
              labels.push(p);
              continue;
            }
            const p = type ? this.pattern(label.pattern, type, governing) : { kind: 'Bad' },
              when = label.whenClause ? this.condition(label.whenClause.condition) : null;
            labels.push({ ...p, when });
          }
          const ofLabels = [...switchScope.keys()].filter(name => !shared.has(name));
          const body = this.block(section, { statements: section.statements, scoped: false });
          if (body.completes && section.statements.length) {
            const last = section.labels.at(-1),
              text =
                last.kind === 'DefaultSwitchLabel'
                  ? 'default:'
                  : 'case ' + (last.value ?? last.pattern).toString() + (last.whenClause ? ' ' + last.whenClause.toString() : '') + ':';
            this.report(last, index === syntax.sections.length - 1 ? DiagnosticId.CS8070 : DiagnosticId.CS0163, [text]);
          }
          if (body.completes) anyCompletes = true;
          for (const name of ofLabels) switchScope.delete(name);
          sections.push({ labels, body, syntax: section });
        });
      } finally {
        this.leaveLabels();
        this.popScope();
        this.exitLoop();
      }
      if (governing.type)
        this.reportSwitchArms(
          governing.type,
          sections.flatMap(s =>
            s.labels.map((label, i) => ({
              pattern: label,
              when: label.when ?? null,
              node: s.syntax.labels[i].value ?? s.syntax.labels[i].pattern ?? s.syntax.labels[i],
              isDefault: label.kind === 'default',
            })),
          ),
          { isExpression: false, node: syntax },
        );
      const exhaustive =
        hasDefault || sections.some(s => s.labels.some(l => l.kind === 'DiscardPattern' || (l.kind === 'VarPattern' && !l.when)));
      return stmt('Switch', syntax, sw.hasBreak || !exhaustive || anyCompletes, { governing, sections, gotoTargets: sw.gotoTargets ?? null });
    }
    iteratorElementType() {
      const t = this.c.declaredReturnType ?? this.c.returnType;
      if (!t || t.isErrorType?.()) return null;
      if (t.typeArguments?.length === 1 && ['IEnumerable', 'IEnumerator', 'IAsyncEnumerable', 'IAsyncEnumerator'].includes(t.name))
        return t.typeArguments[0].type;
      if (['IEnumerable', 'IEnumerator'].includes(t.name)) return this.core.object;
      return null;
    }
    returnStatement(syntax) {
      this.sawReturn = true;
      if (this.finallyDepth) this.report(syntax.returnKeyword, DiagnosticId.CS0157);
      if (this.c.isIterator && !this.c.isLambda) {
        if (syntax.expression) this.value(syntax.expression);
        this.report(syntax.returnKeyword ?? syntax, DiagnosticId.CS1622);
        return stmt('Return', syntax, false, {});
      }
      const isRefReturn = syntax.expression?.kind === 'RefExpression',
        expressionSyntax = isRefReturn ? syntax.expression.expression : syntax.expression;
      if (this.c.inferReturn) {
        const e = expressionSyntax ? this.value(expressionSyntax) : null;
        this.returns.push(e);
        return stmt('Return', syntax, false, { expression: e });
      }
      const type = this.c.returnType;
      if (!expressionSyntax) {
        if (type && type.specialType !== 'System_Void' && !type.isErrorType() && !this.c.isTopLevel)
          this.report(syntax.returnKeyword, DiagnosticId.CS0126, [this.display(type)]);
        return stmt('Return', syntax, false, {});
      }
      const e = this.value(expressionSyntax);
      if (!type || type.specialType === 'System_Void') {
        if (this.c.isTopLevel && !type) {
          return stmt('Return', syntax, false, { expression: this.convert(e, this.core.int, expressionSyntax) });
        }
        if (!e.hasErrors)
          this.report(
            syntax.returnKeyword,
            this.c.isAsync && this.c.declaredReturnType && this.c.declaredReturnType.equals(this.core.task)
              ? DiagnosticId.CS1997
              : this.c.isLambda
                ? DiagnosticId.CS8030
                : DiagnosticId.CS0127,
            this.c.isAsync && this.c.declaredReturnType?.equals(this.core.task)
              ? [this.c.method?.toDisplayString() ?? 'lambda expression', 'Task']
              : [
                  this.c.isLambda
                    ? this.c.isAnonymousMethod
                      ? 'anonymous method'
                      : 'lambda expression'
                    : (this.c.method?.toDisplayString() ?? ''),
                ],
          );
        return stmt('Return', syntax, false, { expression: e });
      }
      const refError = checkRefReturn(this.c.returnRefKind, isRefReturn, e.hasErrors ? null : e, {
        ...this.variableContext,
        escapeCheckedByFlow: !this.c.isLambda,
      });
      if (refError && !e.hasErrors)
        this.report(refError.code === DiagnosticId.CS8150 || refError.code === DiagnosticId.CS8149 ? syntax : expressionSyntax, refError.code, refError.args);
      if (isRefReturn) {
        this.markAliased(e);
        if (!e.hasErrors && e.type && !e.type.equals(type) && !type.isErrorType())
          this.report(expressionSyntax, DiagnosticId.CS8151, [this.display(type)]);
        return stmt('Return', syntax, false, { expression: e, isRef: true });
      }
      const converted = this.convertReturned(e, type, expressionSyntax);
      if (e.form === 'lambda' && !converted.hasErrors) this.finishLambda(e, type);
      return stmt('Return', syntax, false, { expression: converted });
    }
  };
