/**
 * Query expressions (SF-A02-T09.5), translated as the C# specification prescribes (§12.20.3) into invocations of
 * `Select`, `Where`, `SelectMany`, `Join`, `GroupJoin`, `OrderBy`, `ThenBy` (and `...Descending`), `GroupBy` and
 * `Cast`. The methods are found by ordinary member lookup and overload resolution on the source expression, so any
 * type with the query pattern works: instance methods, extension methods, generic or not.
 *
 *   from x in e where c select v            e.Where(x => c).Select(x => v)
 *   from x in e from y in f select v        e.SelectMany(x => f, (x, y) => v)
 *   from x in e let y = f where c select v  e.Select(x => new { x, y = f }).Where(* => c).Select(* => v)
 *   from x in e join y in f on a equals b   e.Join(f, x => a, y => b, (x, y) => ...)
 *   ... into g ...                          the translated query becomes the source of the continuation
 *
 * The lambdas are real lambdas of the binder: their parameters are the range variables (or transparent identifiers,
 * binder/query-scope.js) and their bodies are the clause expressions, so conversions, type inference, closures and
 * lowering treat them like lambdas written in source.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind } from '../symbols/types.js';
import { memberPaths, rangeScope, transparentScope } from './query-scope.js';
import { anonymousTypeOf } from '../symbols/synthesized/anonymous-types.js';

const clauseNames = Object.freeze({
  FromClause: 'from',
  LetClause: 'let',
  WhereClause: 'where',
  SelectClause: 'select',
  GroupClause: 'group',
  AscendingOrdering: 'orderby',
  DescendingOrdering: 'orderby',
});
const orderingMethod = (ordering, isFirst) => (isFirst ? 'OrderBy' : 'ThenBy') + (ordering.kind === 'DescendingOrdering' ? 'Descending' : '');

/** Class mixin: query expressions. Applied after the other expression families: it refines `expression` and `identifier`. */
export const QueryBinding = Base =>
  class extends Base {
    expression(syntax, options) {
      if (syntax.kind === 'QueryExpression') return this.queryExpression(syntax);
      if (syntax.kind === 'QueryLambdaBody') return this.queryLambdaBody(syntax);
      return super.expression(syntax, options);
    }
    /** A range variable behind a transparent identifier is a member of the lambda parameter. */
    identifier(syntax, options = {}) {
      const reached = syntax.kind === 'IdentifierName' ? this.c.rangeVariables?.get(syntax.identifier.valueText) : null;
      if (!reached) return super.identifier(syntax, options);
      return this.rangeVariable(reached, syntax);
    }
    rangeVariable({ parameter, path }, syntax) {
      const symbol = this.lookupLocal(parameter);
      let value = this.node('Parameter', syntax, symbol.type, { parameter: symbol });
      for (const member of path) {
        if (!value.type || value.hasErrors) return this.bad(syntax);
        // The members of a transparent identifier are compiler-made properties: no lookup or accessibility applies.
        const property = value.type.getMembers(member).find(m => m.kind === SymbolKind.Property);
        if (!property) return this.bad(syntax);
        value = this.node('PropertyAccess', syntax, property.type, { property, receiver: value });
      }
      return value;
    }
    queryExpression(syntax) {
      const from = syntax.fromClause,
        query = { source: this.querySource(from, this), scope: rangeScope(from.identifier.valueText), transparent: 0 };
      return this.queryBody(query, syntax.body);
    }
    /** The collection of a from or join clause: `e`, or `e.Cast<T>()` when the range variable has a type. */
    querySource(clause, binder) {
      const expressionSyntax = clause.expression ?? clause.inExpression,
        source = binder.value(expressionSyntax);
      // The query pattern is looked up on the static type of the source: a dynamic one has none (a later `from` is CS1943).
      const isLaterFrom = clause.kind === 'FromClause' && clause.parent?.kind !== 'QueryExpression';
      if (!source.hasErrors && source.type?.typeKind === 'dynamic' && !isLaterFrom) {
        binder.report(expressionSyntax, DiagnosticId.CS1979);
        return binder.bad(expressionSyntax);
      }
      if (!clause.type || source.hasErrors) return source;
      const elementType = binder.bindType(clause.type).type;
      return binder.queryCall(source, 'Cast', [], expressionSyntax, [elementType]);
    }
    queryBody(query, body) {
      const clauses = body.clauses,
        final = body.selectOrGroup;
      clauses.forEach((clause, index) => {
        // A from or join directly before the select takes the select expression as its result selector.
        const takesSelect = clause.kind === 'FromClause' || clause.kind === 'JoinClause',
          result = takesSelect && index === clauses.length - 1 && final.kind === 'SelectClause' ? final.expression : null;
        this.queryClause(query, clause, result);
        if (result) query.selected = true;
      });
      if (!query.selected) this.queryFinal(query, final, clauses.length > 0);
      const continuation = body.continuation;
      if (!continuation) return query.source;
      const next = { source: query.source, scope: rangeScope(continuation.identifier.valueText), transparent: query.transparent };
      return this.queryBody(next, continuation.body);
    }
    queryClause(query, clause, result) {
      const { scope } = query,
        call = (name, args) => (query.source = this.queryCall(query.source, name, args, clause));
      switch (clause.kind) {
        case 'WhereClause':
          call('Where', [this.queryLambda([scope], clause.condition)]);
          break;
        case 'OrderByClause':
          clause.orderings.forEach((ordering, i) => {
            query.source = this.queryCall(query.source, orderingMethod(ordering, i === 0), [this.queryLambda([scope], ordering.expression)], ordering);
          });
          break;
        case 'LetClause': {
          const name = clause.identifier.valueText;
          call('Select', [this.pairingLambda([scope], scope.parameter, name, clause.expression, clause)]);
          query.scope = transparentScope(scope, name, query.transparent++);
          break;
        }
        case 'FromClause': {
          const name = clause.identifier.valueText,
            inner = rangeScope(name),
            collection = this.queryLambda([scope], clause, binder => this.querySource(clause, binder));
          call('SelectMany', [collection, this.resultLambda(query, inner, result, clause)]);
          break;
        }
        case 'JoinClause':
          this.joinClause(query, clause, result);
          break;
        default:
          this.incomplete = this.d.incomplete = true;
      }
    }
    joinClause(query, clause, result) {
      const { scope } = query,
        name = clause.identifier.valueText,
        inner = rangeScope(name),
        collection = this.querySource(clause, this),
        outerKey = this.queryLambda([scope], clause.leftExpression),
        innerKey = this.queryLambda([inner], clause.rightExpression);
      // `into g`: the result selector sees the outer variables and the group, not the inner range variable.
      const joined = clause.into ? rangeScope(clause.into.identifier.valueText) : inner;
      const selector = this.resultLambda(query, joined, result, clause);
      query.source = this.queryCall(query.source, clause.into ? 'GroupJoin' : 'Join', [collection, outerKey, innerKey, selector], clause);
    }
    /**
     * The result selector of a from or join clause: `(outer, inner) => v` when the select follows directly, otherwise
     * the pair `(outer, inner) => new { outer, inner }`, which becomes the transparent identifier of what follows.
     */
    resultLambda(query, inner, result, clause) {
      const scopes = [query.scope, inner];
      if (result) return this.queryLambda(scopes, result);
      const lambda = this.pairingLambda(scopes, query.scope.parameter, inner.parameter, null, clause);
      query.scope = transparentScope(query.scope, inner.parameter, query.transparent++);
      return lambda;
    }
    /** `scopes => new { first, second = value }`; without `valueSyntax` the second member is the parameter of its name. */
    pairingLambda(scopes, first, second, valueSyntax, clause) {
      return this.queryLambda(scopes, clause, binder => {
        const parameter = name => {
          const symbol = binder.lookupLocal(name);
          return binder.node('Parameter', clause, symbol.type, { parameter: symbol });
        };
        const values = [parameter(first), valueSyntax ? binder.value(valueSyntax) : parameter(second)];
        if (values.some(value => value.hasErrors || !value.type)) return binder.bad(clause);
        const members = [first, second].map((name, i) => ({ name, type: values[i].type })),
          type = anonymousTypeOf(binder.d, binder.core, members);
        const property = name => type.getMembers(name).find(m => m.kind === SymbolKind.Property),
          initializers = members.map((member, i) => ({ property: property(member.name), value: values[i] }));
        return binder.node('AnonymousObjectCreation', clause, type, { initializers });
      });
    }
    queryFinal(query, final, hasClauses) {
      const { scope } = query,
        single = scope.paths.size === 1 ? scope.parameter : null,
        isRangeVariable = syntax => syntax.kind === 'IdentifierName' && syntax.identifier.valueText === single;
      if (final.kind === 'SelectClause') {
        // `... select x` after other clauses selects what the source already yields: no call (a degenerate select).
        if (hasClauses && isRangeVariable(final.expression)) return;
        query.source = this.queryCall(query.source, 'Select', [this.queryLambda([scope], final.expression)], final);
        return;
      }
      const key = this.queryLambda([scope], final.byExpression),
        args = isRangeVariable(final.groupExpression) ? [key] : [key, this.queryLambda([scope], final.groupExpression)];
      query.source = this.queryCall(query.source, 'GroupBy', args, final);
    }
    /**
     * A lambda over range variable scopes.
     * @param scopes one scope per parameter  @param syntax the body expression, or the clause when `bind` builds the body
     * @param [bind] `binder => bound expression`, run by the binder of the lambda body
     */
    queryLambda(scopes, syntax, bind = null) {
      const span = syntax.span,
        parameters = scopes.map(scope => ({ identifier: { valueText: scope.parameter, span }, modifiers: [], type: null, span }));
      return this.lambda({
        kind: 'ParenthesizedLambdaExpression',
        isQueryLambda: true,
        modifiers: [],
        parameterList: { parameters },
        expressionBody: { kind: 'QueryLambdaBody', rangeVariables: memberPaths(scopes), inner: bind ? null : syntax, bind, span },
        span,
      });
    }
    /** Binds the body of a query lambda (this binder is the lambda's): the range variables come into scope first. */
    queryLambdaBody(syntax) {
      this.c.rangeVariables = new Map([...(this.c.rangeVariables ?? []), ...syntax.rangeVariables]);
      // The errors of the latest binding are kept: when type inference fails because of them, they are what is reported.
      const first = this.quiet?.length ?? 0,
        bound = syntax.bind ? syntax.bind(this) : this.expression(syntax.inner);
      syntax.bodyErrors = this.quiet ? this.quiet.slice(first).filter(error => this.d.isError(error.code)) : [];
      return bound;
    }
    /**
     * Overload resolution of a query method. A failed type inference is reported as Roslyn reports it for a query:
     * against the clause (CS1941 for join, CS1942 otherwise), not as CS0411 against a method the source does not name.
     */
    resolveQueryCall(group, args, syntax) {
      const outer = this.quiet,
        errors = [];
      this.quiet = errors;
      let result;
      try {
        result = this.call(group, args, syntax);
      } finally {
        this.quiet = outer;
      }
      const keyword = syntax.childTokens?.()[0] ?? syntax,
        bodyErrors = args.flatMap(argument => argument.syntax?.expressionBody?.bodyErrors ?? []);
      for (const error of errors) {
        if (error.code !== DiagnosticId.CS0411) this.report(error.node, error.code, error.args);
        else if (bodyErrors.length) for (const inner of bodyErrors.splice(0)) this.report(inner.node, inner.code, inner.args);
        else if (syntax.kind === 'JoinClause') this.report(keyword, DiagnosticId.CS1941, ['join', group.name]);
        else this.report(keyword, DiagnosticId.CS1942, [clauseNames[syntax.kind] ?? 'select', group.name]);
      }
      return result;
    }
    /**
     * `receiver.name<typeArguments>(args)`, resolved like an invocation written in source. A source type without the
     * method reports CS1936 (the query pattern is not implemented).
     */
    queryCall(receiver, name, args, syntax, typeArguments = null) {
      if (receiver.hasErrors || !receiver.type) return this.bad(syntax);
      const outer = this.quiet,
        errors = [];
      this.quiet = errors;
      let group;
      try {
        group = this.instanceMember(receiver, receiver.type, name, syntax, syntax, typeArguments, { invoked: true });
      } finally {
        this.quiet = outer;
      }
      if (group.kind === 'MethodGroup') return this.resolveQueryCall(group, args, syntax);
      if (errors.length) this.report(receiver.syntax, DiagnosticId.CS1936, [this.display(receiver.type), name]);
      return this.bad(syntax);
    }
  };
