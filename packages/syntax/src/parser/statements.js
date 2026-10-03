import { accessibilityModifiers } from './modifiers.js';
import { reusableStatements } from '../incremental/blender.js';
/**
 * Statement parsing: the dispatch from a statement's first token to the module that parses it, blocks, and the simple
 * control-flow statements. Every statement node starts with its (usually empty) attribute lists, as in Roslyn.
 */
/** First token kind to the parser method for that statement. A method returns null when the token does not start its statement here. */
const statementHandlers = new Map([
  ['{', 'blockStatement'],
  [';', 'emptyStatement'],
  ['if', 'ifStatement'],
  ['while', 'whileStatement'],
  ['do', 'doStatement'],
  ['for', 'forStatement'],
  ['foreach', 'forEachStatement'],
  ['switch', 'switchStatement'],
  ['return', 'returnStatement'],
  ['throw', 'throwStatement'],
  ['break', 'breakOrContinueStatement'],
  ['continue', 'breakOrContinueStatement'],
  ['goto', 'gotoStatement'],
  ['try', 'tryStatement'],
  ['lock', 'lockStatement'],
  ['fixed', 'fixedStatement'],
  ['checked', 'checkedStatement'],
  ['unchecked', 'checkedStatement'],
  ['unsafe', 'unsafeStatement'],
  ['using', 'usingStatement'],
  ['await', 'awaitStatement']
]);
/** Tokens that can start a statement besides those that start an expression or a type. */
const statementKeywords = new Set([...statementHandlers.keys(), 'const', 'static', 'extern', 'readonly', 'volatile', 'ref', 'void']);
export const statementMethods = {
  canStartStatement(token = this.current) {
    return statementKeywords.has(token.kind) || this.canStartExpression(token) || this.isPredefined(token);
  },
  block(attributeLists = null) {
    // Statements never inherit the expression context (conditional colon, tuple or declaration position) the block appears in.
    const open = this.expect('{'),
      statements = [],
      saved = this.colonDepth,
      tuple = this.tupleContext,
      declaration = this.declarationContext,
      restricted = this.restrictedVariables;
    this.restrictedVariables = false;
    this.colonDepth = 0;
    this.tupleContext = false;
    this.declarationContext = 0;
    while (!this.at('}') && !this.at('eof') && !accessibilityModifiers.has(this.current.kind) && !this.at('namespace')) {
      const before = this.i,
        reused = this.blend ? this.reuse(reusableStatements, 'statement') : null;
      if (reused) {
        statements.push(reused);
        continue;
      }
      if (!this.canStartStatement()) {
        this.skipUnexpected('CS1525', `Invalid expression term '${this.current.text}'`);
        continue;
      }
      statements.push(this.statement());
      this.guardProgress(before);
    }
    this.colonDepth = saved;
    this.tupleContext = tuple;
    this.declarationContext = declaration;
    this.restrictedVariables = restricted;
    return this.n('Block', attributeLists, open, statements, this.expect('}'));
  },
  /** Parses one statement. `attributeLists` may be supplied by a caller that already consumed them. */
  statement(attributeLists = null) {
    if (!this.enter()) {
      this.leave();
      this.skipRest();
      return this.n('EmptyStatement', attributeLists, this.cache.missing('SemicolonToken'));
    }
    if (!attributeLists) {
      this.statementStart = this.i;
      if (this.at('[') && this.isAttributeListAhead()) attributeLists = this.attributeLists();
    }
    const result = this.statementCore(attributeLists);
    this.leave();
    return result;
  },
  embedded() {
    return this.statement();
  },
  /** Dispatches on the first token through the statement table, then tries the contextual forms, a declaration and an expression. */
  statementCore(attributeLists) {
    const handler = statementHandlers.get(this.current.kind);
    const statement = handler ? this[handler](attributeLists) : null;
    if (statement) return statement;
    const contextual = this.yieldStatement(attributeLists) ?? this.labeledStatement(attributeLists);
    if (contextual) return contextual;
    if (this.isLocalModifier() || this.isLocalDeclaration()) return this.localDeclaration(attributeLists);
    const expression = this.expression();
    return this.n('ExpressionStatement', attributeLists, expression, this.expect(';'));
  },
  blockStatement(attributeLists) {
    return this.block(attributeLists);
  },
  emptyStatement(attributeLists) {
    return this.n('EmptyStatement', attributeLists, this.take());
  },
  ifStatement(attributeLists) {
    const keyword = this.take();
    const open = this.expect('(');
    const condition = this.expression();
    const close = this.expect(')');
    const then = this.embedded();
    const elseClause = this.at('else') ? this.n('ElseClause', this.take(), this.embedded()) : null;
    return this.n('IfStatement', attributeLists, keyword, open, condition, close, then, elseClause);
  },
  whileStatement(attributeLists) {
    return this.n('WhileStatement', attributeLists, this.take(), this.expect('('), this.expression(), this.expect(')'), this.embedded());
  },
  doStatement(attributeLists) {
    const keyword = this.take();
    const body = this.embedded();
    const whileKeyword = this.expect('while');
    const open = this.expect('(');
    const condition = this.expression();
    return this.n('DoStatement', attributeLists, keyword, body, whileKeyword, open, condition, this.expect(')'), this.expect(';'));
  },
  /** `foreach (T x in e)`, or the deconstructing form `foreach (var (a, b) in e)` when no `type identifier` pair starts the header. */
  forEachStatement(attrs, awaitKeyword) {
    const keyword = this.take(),
      open = this.expect('('),
      end = this.scanType(this.i);
    if (end > this.i && this.isId(this.tokens[end]) && this.kindAt(end) !== 'in') {
      const type = this.type(),
        identifier = this.id(),
        inKeyword = this.expectIn();
      return this.n(
        'ForEachStatement',
        attrs,
        awaitKeyword,
        keyword,
        open,
        type,
        identifier,
        inKeyword,
        this.expression(),
        this.expect(')'),
        this.embedded()
      );
    }
    this.declarationContext = (this.declarationContext ?? 0) + 1;
    const variable = this.expression();
    this.declarationContext--;
    return this.n(
      'ForEachVariableStatement',
      attrs,
      awaitKeyword,
      keyword,
      open,
      variable,
      this.expectIn(),
      this.expression(),
      this.expect(')'),
      this.embedded()
    );
  },
  expectIn() {
    if (this.at('in')) return this.take();
    this.error(this.errorAnchor(), 'CS1515', "'in' expected");
    return this.missing('in');
  }
};
