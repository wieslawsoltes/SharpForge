/**
 * foreach over every enumeration pattern, switch statements with patterns, try/catch/finally and return.
 */
import { SymbolKind, TypeKind, ErrorTypeSymbol, ArrayTypeSymbol } from '../../symbols/types.js';
import { LocalDeclarationKind } from '../../symbols/members.js';
import { lookupMembers } from '../inheritance.js';
import { findConstruction, implementsInterface } from '../../symbols/substitution.js';
import { checkRefReturn } from '../ref-locals.js';
import { numericKind } from '../../conversions/numeric.js';

const unknown = ErrorTypeSymbol.unknown;
const isSourceType = t => {
  for (let s = t?.originalDefinition ?? t; s; s = s.containingSymbol) if (s.isSource) return true;
  return false;
};
const stmt = (kind, syntax, completes, props) => ({ kind, syntax, completes, ...props });

/** Class mixin: foreach over every enumeration pattern, switch statements with patterns, try/catch/finally and return. */
export const FlowStatementBinding = Base =>
  class extends Base {
    forEach(syntax) {
      const collection = this.value(syntax.expression);
      this.pushScope();
      try {
        let element = null;
        const type = collection.type;
        if (!collection.hasErrors && type && !type.isErrorType()) {
          if (type instanceof ArrayTypeSymbol) element = type.elementType;
          else if (type.specialType === 'System_String') element = this.core.char;
          else {
            const getEnumerator = lookupMembers(type, 'GetEnumerator', this.core, { within: this.c.containingType }).members.find(
              m => m.kind === SymbolKind.Method && !m.isStatic && !m.parameters.length && m.declaredAccessibility === 'public',
            );
            if (getEnumerator && getEnumerator.returnType && !getEnumerator.returnType.isErrorType()) {
              const current = lookupMembers(getEnumerator.returnType, 'Current', this.core, { within: this.c.containingType }).members.find(
                m => m.kind === SymbolKind.Property,
              );
              if (current) element = current.type;
              else {
                const generic = findConstruction(getEnumerator.returnType, this.core.ienumeratorT, this.core);
                element = generic ? generic.typeArguments[0].type : isSourceType(getEnumerator.returnType) ? null : unknown;
                if (!element) {
                  this.report(syntax.expression, 'CS0117', [this.display(getEnumerator.returnType), 'Current']);
                  element = unknown;
                }
              }
            } else {
              const generic = findConstruction(type, this.core.ienumerableT, this.core);
              if (generic) element = generic.typeArguments[0].type;
              else if (implementsInterface(type, this.core.ienumerable, this.core)) element = this.core.object;
              else if (
                !isSourceType(type) &&
                type.typeKind !== TypeKind.TypeParameter &&
                !numericKind(type) &&
                !['System_Boolean', 'System_Object', 'System_Char'].includes(type.specialType) &&
                type.typeKind !== TypeKind.Enum
              ) {
                element = unknown;
                this.incomplete = this.d.incomplete = true;
              } else {
                this.report(syntax.expression, 'CS1579', [this.display(type), 'GetEnumerator']);
                element = unknown;
              }
            }
          }
        } else if (!collection.hasErrors && !type) {
          this.report(syntax.expression, 'CS0186');
        }
        element ??= unknown;
        const bound = this.bindType(syntax.type.kind === 'RefType' ? syntax.type.type : syntax.type, { allowVar: true }),
          iterationType = bound.isVar ? element : bound.type;
        if (!bound.isVar && !element.isErrorType() && !iterationType.isErrorType()) {
          const c = this.conversions.classifyExplicit(element, iterationType);
          if (!c.exists) this.report(syntax.forEachKeyword, 'CS0030', [this.display(element), this.display(iterationType)]);
        }
        const name = syntax.identifier.valueText,
          local = this.newLocal(name, iterationType, syntax.identifier, LocalDeclarationKind.Foreach);
        local.writes++;
        local.nonConstantWrite = true;
        local.reads++;
        this.declare(name, local, syntax.identifier);
        const loop = this.enterLoop(),
          body = this.embedded(syntax.statement);
        this.exitLoop();
        return stmt('ForEach', syntax, true, { collection, local, elementType: element, body });
      } finally {
        this.popScope();
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
        const type = governing.hasErrors ? null : governing.type,
          pendingNames = [];
        if (type?.specialType === 'System_Boolean') this.d.gate(this.c.uri, syntax.expression, 'SwitchOnBool');
        for (const section of syntax.sections)
          for (const s of section.statements)
            if (s.kind === 'LocalDeclarationStatement')
              for (const v of s.declaration.variables) this.pending.at(-1).add(v.identifier.valueText);
        syntax.sections.forEach((section, index) => {
          const labels = [];
          this.pushScope();
          for (const label of section.labels) {
            if (label.kind === 'DefaultSwitchLabel') {
              if (hasDefault) this.report(label, 'CS0152', ['default']);
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
                  this.report(label, 'CS0152', [
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
          const body = this.block(section, { statements: section.statements, scoped: false });
          if (body.completes && section.statements.length) {
            const last = section.labels.at(-1),
              text =
                last.kind === 'DefaultSwitchLabel'
                  ? 'default:'
                  : 'case ' + (last.value ?? last.pattern).toString() + (last.whenClause ? ' ' + last.whenClause.toString() : '') + ':';
            this.report(last, index === syntax.sections.length - 1 ? 'CS8070' : 'CS0163', [text]);
          }
          if (body.completes) anyCompletes = true;
          this.popScope();
          sections.push({ labels, body, syntax: section });
        });
      } finally {
        this.leaveLabels();
        this.popScope();
        this.exitLoop();
      }
      const exhaustive =
        hasDefault || sections.some(s => s.labels.some(l => l.kind === 'DiscardPattern' || (l.kind === 'VarPattern' && !l.when)));
      return stmt('Switch', syntax, sw.hasBreak || !exhaustive || anyCompletes, { governing, sections, gotoTargets: sw.gotoTargets ?? null });
    }
    tryStatement(syntax) {
      const body = this.block(syntax.block),
        catches = [],
        caught = [];
      let completes = body.completes;
      for (const clause of syntax.catches) {
        this.pushScope();
        try {
          let type = this.core.exception,
            local = null;
          if (clause.declaration) {
            type = this.bindType(clause.declaration.type).type;
            if (
              !type.isErrorType() &&
              !(
                type.equals(this.core.exception) ||
                this.conversions.classifyImplicit(type, this.core.exception).exists ||
                type.typeKind === TypeKind.TypeParameter
              )
            ) {
              this.report(clause.declaration.type, 'CS0155');
              type = unknown;
            }
            if (clause.declaration.identifier) {
              local = this.newLocal(
                clause.declaration.identifier.valueText,
                type,
                clause.declaration.identifier,
                LocalDeclarationKind.Catch,
              );
              local.writes++;
              local.isCatch = true;
              this.declare(local.name, local, clause.declaration.identifier);
            }
          }
          const filter = clause.filter ? this.condition(clause.filter.filterExpression) : null;
          if (!type.isErrorType() && !filter) {
            const previous = caught.find(t => t.equals(type) || this.conversions.classifyImplicit(type, t).exists);
            if (previous)
              this.report(clause.declaration?.type ?? clause.catchKeyword, clause.declaration ? 'CS0160' : 'CS1017', [
                this.display(previous),
              ]);
          }
          if (!filter) caught.push(type);
          this.catchDepth++;
          const savedFinally = this.finallyInCatch;
          this.finallyInCatch = false;
          const block = this.block(clause.block);
          this.finallyInCatch = savedFinally;
          this.catchDepth--;
          if (block.completes) completes = true;
          catches.push({ type, local, filter, block });
        } finally {
          this.popScope();
        }
      }
      let finallyBlock = null;
      if (syntax.finally) {
        this.finallyDepth++;
        const saved = this.finallyInCatch;
        this.finallyInCatch = this.catchDepth > 0;
        finallyBlock = this.block(syntax.finally.block);
        this.finallyInCatch = saved;
        this.finallyDepth--;
        if (!finallyBlock.completes) completes = false;
      }
      return stmt('Try', syntax, completes, { body, catches, finallyBlock });
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
      if (this.finallyDepth) this.report(syntax.returnKeyword, 'CS0157');
      if (this.c.isIterator && !this.c.isLambda) {
        if (syntax.expression) this.value(syntax.expression);
        this.report(syntax.returnKeyword ?? syntax, 'CS1622');
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
          this.report(syntax.returnKeyword, 'CS0126', [this.display(type)]);
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
            this.c.isAsync && this.c.declaredReturnType && this.c.declaredReturnType.equals(this.core.task) ? 'CS1997' : 'CS0127',
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
        this.report(refError.code === 'CS8150' || refError.code === 'CS8149' ? syntax : expressionSyntax, refError.code, refError.args);
      if (isRefReturn) {
        this.markAliased(e);
        if (!e.hasErrors && e.type && !e.type.equals(type) && !type.isErrorType())
          this.report(expressionSyntax, 'CS8151', [this.display(type)]);
        return stmt('Return', syntax, false, { expression: e, isRef: true });
      }
      const converted = this.convert(e, type, expressionSyntax);
      if (e.form === 'lambda' && !converted.hasErrors) this.finishLambda(e, type);
      return stmt('Return', syntax, false, { expression: converted });
    }
  };
