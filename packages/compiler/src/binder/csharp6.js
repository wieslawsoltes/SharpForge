/**
 * C# 6 binding rules that are decided without the binder's state (SF-A02-T61): what the argument of `nameof` may
 * be, which members `using static` brings into scope for a simple name, and the warnings for an exception filter
 * that is a constant. Each function answers with data; the body binder reports and builds the bound nodes.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind } from '../symbols/types.js';
import { ConstantValue } from '../constants/constant-value.js';
import {namedSourceReferences} from './named-references.js';

const nameKinds = new Set(['IdentifierName', 'GenericName']);
const missingMemberCodes = new Set([DiagnosticId.CS0117, DiagnosticId.CS1061]);
/** The largest magnitude of an interpolation alignment: beyond it the format item is invalid at run time. */
const alignmentLimit = 32767;
/** What may stand to the left of a `.` inside a `nameof` argument, besides a name or another member access. */
const qualifierKinds = new Set(['PredefinedType', 'ThisExpression', 'BaseExpression', 'AliasQualifiedName']);

/**
 * Checks the shape of a `nameof` argument: a simple name or a member access whose qualifiers are names.
 * Roslyn applies this after the argument bound without errors.
 * @param expression the argument's expression syntax
 * @returns {null|{code:string,node:object}} CS8081 (no name), CS8082 (a sub-expression that is not a name) or
 *   CS8083 (an alias-qualified name), with the syntax to report it on
 */
export function nameofArgumentProblem(expression) {
  if (nameKinds.has(expression.kind)) return null;
  if (expression.kind === 'AliasQualifiedName') return { code: DiagnosticId.CS8083, node: expression };
  if (expression.kind !== 'SimpleMemberAccessExpression') return { code: DiagnosticId.CS8081, node: expression };
  for (let left = expression.expression; ; left = left.expression) {
    if (nameKinds.has(left.kind) || qualifierKinds.has(left.kind)) return null;
    if (left.kind !== 'SimpleMemberAccessExpression') return { code: DiagnosticId.CS8082, node: left };
  }
}

/** The name a valid `nameof` argument denotes: its last identifier. */
export function nameofValue(expression) {
  const last = expression.kind === 'SimpleMemberAccessExpression' ? expression.name : expression;
  return last.identifier?.valueText ?? last.toString();
}

/**
 * The static members named `name` that `using static` directives of one scope level import for a simple name.
 * Extension methods are not imported this way (they are found only as instance calls), and neither are instance
 * members. Methods of several types form one group; a field, property or event found in two types is ambiguous.
 * @param {object[]} staticTypes the types of the `using static` directives  @param {string} name
 * @returns {{members:object[], ambiguous:null|object[]}} `ambiguous` holds the two members CS0229 names
 */
export function staticImportsNamed(staticTypes, name) {
  const found = staticTypes.flatMap(type => type.getMembers(name).filter(member => member.isStatic && !member.isExtensionMethod));
  if (!found.length) return { members: [], ambiguous: null };
  const members = found.filter(member => member.kind === found[0].kind);
  const isGroup = found[0].kind === SymbolKind.Method;
  if (!isGroup && found.length > 1) return { members, ambiguous: [found[0], found[1]] };
  return { members, ambiguous: null };
}

/** The text of a literal part of an interpolated string: `{{` and `}}` stand for one brace. */
export function interpolatedText(content) {
  const text = content.textToken.value ?? content.textToken.valueText;
  return text.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
}

/**
 * The warning for an exception filter whose condition is a constant, or null.
 * @param {boolean} value the constant value of the filter
 * @param {boolean} isOnlyHandler true when the try statement has no other catch clause and no finally block
 * @returns {string} CS7095 (always true), CS8360 (always false, the whole try-catch is redundant) or CS8359
 */
export function constantFilterWarning(value, isOnlyHandler) {
  if (value) return DiagnosticId.CS7095;
  return isOnlyHandler ? DiagnosticId.CS8360 : DiagnosticId.CS8359;
}

/** Class mixin for the body binder: the `nameof` operator, null-conditional statements and constant exception filters. */
export const CSharp6Binding = Base =>
  class extends Base {
    invocation(syntax) {
      const callee = syntax.expression;
      // `nameof` is an operator only when no method, local or type of that name is in scope.
      const isOperator =
        callee.kind === 'IdentifierName' &&
        callee.identifier.valueText === 'nameof' &&
        this.expression(callee, { invoked: true }).kind === 'NameOfMarker';
      return isOperator ? this.nameofExpression(syntax) : super.invocation(syntax);
    }
    /** `nameof(x)`: a string constant; the argument is bound for its errors and uses but never evaluated. */
    nameofExpression(syntax) {
      const args = syntax.argumentList.arguments;
      if (args.length !== 1) {
        // With any other number of arguments this is a call to a method named nameof, and there is none.
        this.report(syntax.expression, DiagnosticId.CS0103, ['nameof']);
        return this.bad(syntax, { args: this.arguments(syntax.argumentList) });
      }
      this.d.gate(this.c.uri, syntax, 'Nameof');
      const argument = args[0].expression,
        { operand, errors } = this.nameofOperand(argument),
        node = this.node('NameOf', syntax, this.core.string);
      // The result is a string whatever the argument is. It stays a constant when the argument at least names
      // something: Roslyn keeps the name after "no such member", and after the shape errors below.
      if (errors.length && !errors.every(row => missingMemberCodes.has(row.code))) return node;
      const problem = errors.length ? null : nameofArgumentProblem(argument);
      if (problem) this.report(problem.node, problem.code);
      else if (operand.kind === 'MethodGroup' && operand.typeArguments) this.report(argument, DiagnosticId.CS8084);
      if (operand.kind === 'Local') operand.local.reads++;
      if (!errors.length) node.nameOfReferences = namedSourceReferences(operand);
      node.constantValue = ConstantValue.string(nameofValue(argument));
      return node;
    }
    /**
     * Binds the argument of `nameof`. Its diagnostics are reported only when it has errors; an argument the closed
     * framework registry cannot resolve has none.
     * @returns {{operand: object, errors: object[]}} the bound argument and the error rows that were reported
     */
    nameofOperand(argument) {
      const saved = this.quiet,
        collected = [];
      this.quiet = collected;
      let operand;
      try {
        operand = this.expression(argument, { nameofOperand: true });
      } finally {
        this.quiet = saved;
      }
      if (!operand.hasErrors) return { operand, errors: [] };
      for (const row of collected) this.report(row.node, row.code, row.args);
      return { operand, errors: collected.filter(row => this.d.isError(row.code)) };
    }
    /**
     * `$"text {value,alignment:format}"`: every hole is a value, an alignment is an `int` constant (CS0150; CS8094
     * beyond the range a format item allows). A string whose holes are all constant strings, without
     * alignment or format, is itself a constant (a C# 10 feature).
     */
    interpolatedString(syntax) {
      const parts = [],
        alignments = [];
      // Constant also below C# 10: the language-version gate reports the feature there, not a second error.
      let text = '',
        isConstant = true;
      for (const content of syntax.contents) {
        if (content.kind !== 'Interpolation') {
          text += interpolatedText(content);
          continue;
        }
        const part = this.interpolationHole(content);
        parts.push(part);
        alignments.push(content.alignmentClause ? this.interpolationAlignment(content.alignmentClause.value) : null);
        const value = part.constantValue;
        if (!value || typeof value.value !== 'string' || content.alignmentClause || content.formatClause) isConstant = false;
        else text += value.value;
      }
      // `alignments` holds, per hole, the constant alignment or null.
      const node = this.node('InterpolatedString', syntax, this.core.string, { parts, alignments, form: 'interpolatedString' });
      if (isConstant) node.constantValue = ConstantValue.string(text);
      return node;
    }
    /** The value of one hole, with its alignment checked; a hole without a value is reported as Roslyn reports it. */
    interpolationHole(content) {
      const value = this.value(content.expression);
      if (value.hasErrors) return value;
      if (value.type?.specialType === 'System_Void') {
        this.report(content.expression, DiagnosticId.CS1503, [1, 'void', 'object']);
        return this.bad(content.expression);
      }
      // A lambda or method group goes into the hole as `object`, through its natural type from C# 10.
      return value.type ? value : this.convert(value, this.core.object, content.expression);
    }
    /** Checks an alignment and returns its constant value, or null after an error. */
    interpolationAlignment(syntax) {
      const alignment = this.convert(this.value(syntax), this.core.int, syntax);
      if (alignment.hasErrors) return null;
      const constant = alignment.constantValue;
      if (!constant) {
        this.report(syntax, DiagnosticId.CS0150);
        return null;
      }
      const width = Number(constant.value);
      if (Math.abs(width) > alignmentLimit) this.report(syntax, DiagnosticId.CS8094, [alignmentLimit]);
      return width;
    }
    /** `a?.M();` is a statement; `a?.Name;` is not (CS0201): what follows the last `?.` decides. */
    isStatementExpression(syntax) {
      if (syntax.kind === 'ConditionalAccessExpression') return this.isStatementExpression(syntax.whenNotNull);
      return super.isStatementExpression(syntax);
    }
    catchClause(clause, order) {
      const bound = super.catchClause(clause, order),
        constant = bound.filter?.constantValue;
      if (constant && typeof constant.value === 'boolean') {
        const statement = clause.parent,
          isOnlyHandler = statement.catches.length === 1 && !statement.finally;
        this.report(clause.filter.filterExpression, constantFilterWarning(constant.value, isOnlyHandler));
      }
      return bound;
    }
  };
