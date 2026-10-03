import { accessibilityModifiers } from './modifiers.js';
import { reusableStatements } from '../incremental/blender.js';
/** Statements, local declarations and local functions. Every statement node starts with its (usually empty) attribute lists, as in Roslyn. */
const statementKeywords = new Set(['{', ';', 'if', 'switch', 'while', 'do', 'for', 'foreach', 'return', 'break', 'continue', 'throw', 'try', 'goto', 'lock', 'fixed', 'using', 'checked', 'unchecked', 'unsafe', 'const', 'static', 'extern', 'readonly', 'volatile', 'ref', 'void']);
const localFollowers = new Set(['=', ';', ',', ')', '(', '<', '[', 'in', 'eof', '}']);
export const statementMethods = {
  canStartStatement(token = this.current) { return statementKeywords.has(token.kind) || this.canStartExpression(token) || this.isPredefined(token); },
  block(attributeLists = null) {
    // Statements never inherit the expression context (conditional colon, tuple or declaration position) the block appears in.
    const open = this.expect('{'), statements = [], saved = this.colonDepth, tuple = this.tupleContext, declaration = this.declarationContext; this.colonDepth = 0; this.tupleContext = false; this.declarationContext = 0;
    while (!this.at('}') && !this.at('eof') && !accessibilityModifiers.has(this.current.kind) && !this.at('namespace')) {
      const before = this.i, reused = this.blend ? this.reuse(reusableStatements, 'statement') : null; if (reused) { statements.push(reused); continue; }
      if (!this.canStartStatement()) { this.skipUnexpected('CS1525', `Invalid expression term '${this.current.text}'`); continue; }
      statements.push(this.statement()); this.guardProgress(before);
    }
    this.colonDepth = saved; this.tupleContext = tuple; this.declarationContext = declaration; return this.n('Block', attributeLists, open, statements, this.expect('}'));
  },
  /** True when a local variable declaration or local function starts at `i` (a type followed by an identifier). */
  isLocalDeclaration(i = this.i) {
    const token = this.tokens[i];
    if (token.kind === 'await') return !this.inAsync && this.isId(this.tokens[i + 1]) && ['=', ';', ','].includes(this.kindAt(i + 2));
    if (this.isWord(token, 'scoped') && (this.kindAt(i + 1) === 'ref' || this.isLocalDeclaration(i + 1))) return true;
    if (this.isPredefined(token) && this.kindAt(i + 1) === '.') return false;
    const info = {}, j = this.scanType(i, info); if (j < 0 || j === i) return false;
    const name = this.tokens[j]; if (!this.isId(name)) return false;
    return localFollowers.has(this.kindAt(j + 1)) || !!info.predefined;
  },
  isLocalModifier(i = this.i) {
    const kind = this.kindAt(i);
    if (kind === 'const' || kind === 'extern' || kind === 'readonly' || kind === 'volatile') return true;
    if (kind === 'static') return this.isLocalModifier(i + 1) || this.isLocalDeclaration(i + 1);
    if (kind === 'unsafe') return this.kindAt(i + 1) !== '{';
    if (kind === 'async' && !this.tokens[i].flags) return this.isLocalModifier(i + 1) || this.isLocalDeclaration(i + 1) && ['(', '<'].includes(this.kindAt(this.scanType(i + 1) + 1));
    return false;
  },
  /** `type name = value, ...` without the terminating semicolon (used by for, using and fixed). */
  variableDeclaration() {
    const type = this.atWord('scoped') && (this.peek().kind === 'ref' || this.isLocalDeclaration(this.i + 1)) ? this.n('ScopedType', this.takeWord('scoped'), this.type()) : this.type();
    return this.n('VariableDeclaration', type, this.variableDeclarators());
  },
  localDeclaration(attributeLists, awaitKeyword = null, usingKeyword = null) {
    const modifiers = []; while (this.isLocalModifier()) modifiers.push(this.at('async') ? this.takeWord('async') : this.take());
    const start = this.current, type = this.atWord('scoped') && (this.peek().kind === 'ref' || this.isLocalDeclaration(this.i + 1)) ? this.n('ScopedType', this.takeWord('scoped'), this.type()) : this.type();
    if (type.kind === 'RefType') this.feature('RefLocalsReturns', start);
    const identifier = this.id();
    if ((this.at('(') || this.at('<')) && !usingKeyword) {
      this.feature('LocalFunctions', start);
      const typeParameters = this.at('<') ? this.typeParameterList() : null, parameters = this.parameterList(), constraints = this.constraintClauses(), [body, expressionBody, semicolon] = this.asyncBody(modifiers, () => this.functionBody());
      return this.n('LocalFunctionStatement', attributeLists, modifiers, type, identifier, typeParameters, parameters, constraints, body, expressionBody, semicolon);
    }
    if (type.kind === 'IdentifierName' && start.value === 'var' && !start.flags) this.feature('ImplicitLocal', start);
    return this.n('LocalDeclarationStatement', attributeLists, awaitKeyword, usingKeyword, modifiers, this.n('VariableDeclaration', type, this.variableDeclarators(identifier)), this.expect(';'));
  },
  /** Parses one statement. `attributeLists` may be supplied by a caller that already consumed them. */
  statement(attributeLists = null) {
    if (!this.enter()) { this.leave(); this.skipRest(); return this.n('EmptyStatement', attributeLists, this.cache.missing('SemicolonToken')); }
    attributeLists ??= this.at('[') && this.isAttributeListAhead() ? this.attributeLists() : null;
    const result = this.statementCore(attributeLists); this.leave(); return result;
  },
  embedded() { return this.statement(); },
  statementCore(attrs) {
    const token = this.current, kind = token.kind, next = this.peek();
    switch (kind) {
      case '{': return this.block(attrs);
      case ';': return this.n('EmptyStatement', attrs, this.take());
      case 'if': { const keyword = this.take(), open = this.expect('('), condition = this.expression(), close = this.expect(')'), then = this.embedded(); return this.n('IfStatement', attrs, keyword, open, condition, close, then, this.at('else') ? this.n('ElseClause', this.take(), this.embedded()) : null); }
      case 'while': return this.n('WhileStatement', attrs, this.take(), this.expect('('), this.expression(), this.expect(')'), this.embedded());
      case 'do': return this.n('DoStatement', attrs, this.take(), this.embedded(), this.expect('while'), this.expect('('), this.expression(), this.expect(')'), this.expect(';'));
      case 'for': return this.forStatement(attrs);
      case 'foreach': return this.forEachStatement(attrs, null);
      case 'switch': return this.switchStatement(attrs);
      case 'return': return this.n('ReturnStatement', attrs, this.take(), this.at(';') ? null : this.expressionOrRef(), this.expect(';'));
      case 'throw': return this.n('ThrowStatement', attrs, this.take(), this.at(';') ? null : this.expression(), this.expect(';'));
      case 'break': case 'continue': {
        const keyword = this.take(), label = this.isId() ? this.take('IdentifierToken') : null; if (label) this.feature('LabeledBreakContinue', this.tokens[this.i - 1]);
        return this.n(kind === 'break' ? 'BreakStatement' : 'ContinueStatement', attrs, keyword, label, this.expect(';'));
      }
      case 'goto': {
        const keyword = this.take();
        if (this.at('case')) return this.n('GotoCaseStatement', attrs, keyword, this.take(), this.expression(), this.expect(';'));
        if (this.at('default')) return this.n('GotoDefaultStatement', attrs, keyword, this.take(), null, this.expect(';'));
        return this.n('GotoStatement', attrs, keyword, null, this.n('IdentifierName', this.id()), this.expect(';'));
      }
      case 'try': return this.tryStatement(attrs);
      case 'lock': return this.n('LockStatement', attrs, this.take(), this.expect('('), this.expression(), this.expect(')'), this.embedded());
      case 'fixed': return this.n('FixedStatement', attrs, this.take(), this.expect('('), this.variableDeclaration(), this.expect(')'), this.embedded());
      case 'checked': case 'unchecked': if (next.kind === '{') return this.n(kind === 'checked' ? 'CheckedStatement' : 'UncheckedStatement', attrs, this.take(), this.block()); break;
      case 'unsafe': if (next.kind === '{') return this.n('UnsafeStatement', attrs, this.take(), this.block()); break;
      case 'using': return this.usingStatement(attrs, null);
      case 'await':
        if (next.kind === 'using') { this.feature('AsyncStreams', token); return this.usingStatement(attrs, this.takeWord('await')); }
        if (next.kind === 'foreach') { this.feature('AsyncStreams', token); return this.forEachStatement(attrs, this.takeWord('await')); }
        break;
    }
    if (this.isWord(token, 'yield') && (next.kind === 'return' || next.kind === 'break')) {
      this.feature('Iterators', token); const keyword = this.takeWord('yield'), second = this.take(), isReturn = next.kind === 'return';
      return this.n(isReturn ? 'YieldReturnStatement' : 'YieldBreakStatement', attrs, keyword, second, isReturn ? this.expression() : null, this.expect(';'));
    }
    if (this.isId(token) && next.kind === ':' && kind !== 'await') return this.n('LabeledStatement', attrs, this.take('IdentifierToken'), this.take(), this.statement());
    if (this.isLocalModifier() || this.isLocalDeclaration()) return this.localDeclaration(attrs);
    const expression = this.expression();
    return this.n('ExpressionStatement', attrs, expression, this.expect(';'));
  },
  usingStatement(attrs, awaitKeyword) {
    const keyword = this.take();
    if (!this.at('(')) { this.feature('UsingDeclarations', this.tokens[this.i - 1]); return this.localDeclaration(attrs, awaitKeyword, keyword); }
    const open = this.take(), declaration = this.isLocalDeclaration() ? this.variableDeclaration() : null, expression = declaration ? null : this.expression();
    return this.n('UsingStatement', attrs, awaitKeyword, keyword, open, declaration, expression, this.expect(')'), this.embedded());
  },
  forStatement(attrs) {
    const keyword = this.take(), open = this.expect('('), list = stop => { const items = []; while (!this.at(stop) && !this.at('eof')) { const before = this.i; items.push(this.expression()); if (this.at(',')) items.push(this.take()); else break; if (before === this.i) break; } return items; };
    const declaration = !this.at(';') && this.isLocalDeclaration() ? this.variableDeclaration() : null, initializers = declaration ? null : list(';'), first = this.expect(';');
    const condition = this.at(';') ? null : this.expression(), second = this.expect(';'), incrementors = list(')');
    return this.n('ForStatement', attrs, keyword, open, declaration, initializers, first, condition, second, incrementors, this.expect(')'), this.embedded());
  },
  forEachStatement(attrs, awaitKeyword) {
    const keyword = this.take(), open = this.expect('('), end = this.scanType(this.i);
    if (end > this.i && this.isId(this.tokens[end]) && this.kindAt(end + 1) === 'in') {
      const type = this.type(), identifier = this.id(), inKeyword = this.take();
      return this.n('ForEachStatement', attrs, awaitKeyword, keyword, open, type, identifier, inKeyword, this.expression(), this.expect(')'), this.embedded());
    }
    this.declarationContext = (this.declarationContext ?? 0) + 1; const variable = this.expression(); this.declarationContext--;
    return this.n('ForEachVariableStatement', attrs, awaitKeyword, keyword, open, variable, this.expect('in'), this.expression(), this.expect(')'), this.embedded());
  },
  switchStatement(attrs) {
    const keyword = this.take(), open = this.expect('('), expression = this.expression(), close = this.expect(')'), brace = this.expect('{'), sections = [];
    while (!this.at('}') && !this.at('eof')) {
      const before = this.i, labels = [], statements = [];
      while (this.at('case') || this.at('default') && this.peek().kind === ':') labels.push(this.switchLabel());
      if (!labels.length) { this.skipUnexpected('CS1525', 'case or default expected'); continue; }
      while (!this.atAny(['case', '}', 'eof']) && !(this.at('default') && this.peek().kind === ':')) { const at = this.i; statements.push(this.statement()); this.guardProgress(at); }
      sections.push(this.n('SwitchSection', labels, statements)); this.guardProgress(before);
    }
    return this.n('SwitchStatement', attrs, keyword, open, expression, close, brace, sections, this.expect('}'));
  },
  switchLabel() {
    const keyword = this.take();
    if (keyword.kind === 'DefaultKeyword') return this.n('DefaultSwitchLabel', keyword, this.expect(':'));
    const start = this.current, pattern = this.pattern(true), when = this.atWord('when') ? this.n('WhenClause', this.takeWord('when'), this.expression()) : null;
    if (pattern.kind === 'ConstantPattern' && !when) return this.n('CaseSwitchLabel', keyword, pattern.children[0], this.expect(':'));
    this.feature('PatternMatching', start); return this.n('CasePatternSwitchLabel', keyword, pattern, when, this.expect(':'));
  },
  tryStatement(attrs) {
    const start = this.current, keyword = this.take(), block = this.block(), catches = [];
    while (this.at('catch')) {
      const catchKeyword = this.take(); let declaration = null, filter = null;
      if (this.at('(')) { const open = this.take(), type = this.type(); declaration = this.n('CatchDeclaration', open, type, this.isId() ? this.take('IdentifierToken') : null, this.expect(')')); }
      if (this.atWord('when') && this.peek().kind === '(') { this.feature('ExceptionFilter', this.current); filter = this.n('CatchFilterClause', this.takeWord('when'), this.take(), this.expression(), this.expect(')')); }
      catches.push(this.n('CatchClause', catchKeyword, declaration, filter, this.block()));
    }
    const final = this.at('finally') ? this.n('FinallyClause', this.take(), this.block()) : null;
    if (!catches.length && !final) this.error(start, 'CS1524', 'Expected catch or finally');
    return this.n('TryStatement', attrs, keyword, block, catches, final);
  }
};
