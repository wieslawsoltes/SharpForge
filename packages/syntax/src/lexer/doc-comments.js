import { GreenNode, GreenToken, GreenTrivia, GreenFlags } from '../green.js';
import { reservedKeywordKinds, predefinedTypes } from './keywords.js';
import { punctuationKinds } from './operators.js';
/**
 * Structured XML documentation comments. A `///` or `/** *\/` trivia is parsed on demand into a green tree shaped like
 * Roslyn's DocumentationCommentTriviaSyntax: XmlElement / XmlEmptyElement / XmlText / XmlCDataSection / XmlComment /
 * XmlProcessingInstruction content, text, cref and name attributes, and cref syntax (qualified, generic, operator,
 * conversion and indexer members with parameter lists). Comment exteriors (`///`, `/**`, ` *`, `*\/`) and whitespace
 * inside tags are trivia, so the structure's full text always equals the comment text. Malformed XML reports CS1570
 * and malformed crefs CS1584 as warnings; no character is dropped.
 */
const empty = Object.freeze([]), entities = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const nameStart = /[\p{L}_]/u, nameChar = /[\p{L}\p{Nd}_.\-]/u, identifierAt = /^@?[\p{L}_][\p{L}\p{Nd}_]*/u;
const isSpace = ch => ch === ' ' || ch === '\t';
const eol = (text, i) => { const ch = text[i]; return ch === '\r' ? (text[i + 1] === '\n' ? 2 : 1) : ch === '\n' || ch === '\u0085' || ch === ' ' || ch === ' ' ? 1 : 0; };
const nameElements = new Set(['param', 'paramref', 'typeparam', 'typeparamref']);
const crefKeywords = new Set([...predefinedTypes, 'this', 'operator', 'implicit', 'explicit', 'checked', 'ref', 'out', 'in', 'readonly', 'true', 'false']);
const crefOperators = ['>>>=', '>>>', '>>=', '<<=', '>>', '<<', '==', '!=', '<=', '>=', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '+', '-', '!', '~', '*', '/', '%', '&', '|', '^', '<', '>'];
export const documentationCommentKinds = Object.freeze(new Set(['SingleLineDocumentationCommentTrivia', 'MultiLineDocumentationCommentTrivia']));
class DocumentationCommentParser {
  constructor(text, kind) {
    this.text = text; this.kind = kind; this.single = kind === 'SingleLineDocumentationCommentTrivia'; this.i = 0; this.pending = []; this.diagnostics = []; this.depth = 0;
    this.limit = !this.single && text.length >= 5 && text.endsWith('*/') ? text.length - 2 : text.length;
  }
  warn(start, end, code = 'CS1570', message = 'XML comment has badly formed XML') { if (this.diagnostics.length < 64) this.diagnostics.push({ code, start, end, message, severity: 'warning' }); }
  trivia(kind, start, end) { if (end > start) this.pending.push(new GreenTrivia(kind, this.text.slice(start, end))); }
  /** Consumes `length` characters as one token carrying the pending trivia. */
  take(kind, length, value) { const start = this.i, leading = this.pending.length ? Object.freeze(this.pending) : empty; this.pending = []; this.i = start + length; return new GreenToken(kind, this.text.slice(start, this.i), value, leading); }
  missing(kind) { return new GreenToken(kind, '', undefined, empty, empty, GreenFlags.Missing); }
  node(kind, ...children) { return new GreenNode(kind, children.map(child => Array.isArray(child) ? (child.length ? new GreenNode('SyntaxList', child) : null) : child ?? null)); }
  at(s) { return this.i + s.length <= this.limit && this.text.startsWith(s, this.i); }
  get done() { return this.i >= this.limit; }
  /** The comment exterior at a line start: `///` (with its indentation), `/**`, or the indentation and optional `*` of a delimited comment line. */
  exterior() {
    const text = this.text; let j = this.i;
    if (this.single || j === 0) { while (isSpace(text[j])) j++; if (text.startsWith(this.single ? '///' : '/**', j)) { this.trivia('DocumentationCommentExteriorTrivia', this.i, j + 3); this.i = j + 3; } return; }
    while (j < this.limit && isSpace(text[j])) j++;
    if (j < this.limit && text[j] === '*') j++;
    this.trivia('DocumentationCommentExteriorTrivia', this.i, j); this.i = j;
  }
  /** Text, newline and entity tokens up to the first offset where `stop` holds. In `raw` mode (CDATA, comments, PIs) `&` and `<` are plain text. */
  textTokens(stop, raw) {
    const text = this.text, out = [];
    while (!this.done && !stop(this.i)) {
      const n = eol(text, this.i);
      if (n) { out.push(this.take('XmlTextLiteralNewLineToken', n, text.slice(this.i, this.i + n))); this.exterior(); continue; }
      if (!raw && text[this.i] === '&') {
        const m = /^&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|([A-Za-z]+));/.exec(text.slice(this.i, this.i + 12)), code = m ? (m[1] ? Number(m[1]) : m[2] ? parseInt(m[2], 16) : -1) : -1;
        const value = !m ? undefined : code >= 0 ? (code <= 0x10FFFF && code > 0 ? String.fromCodePoint(code) : undefined) : entities[m[3]];
        if (value !== undefined) { out.push(this.take('XmlEntityLiteralToken', m[0].length, value)); continue; }
        this.warn(this.i, this.i + 1);
      } else if (!raw && text[this.i] === '<') this.warn(this.i, this.i + 1);
      let j = this.i + 1; while (j < this.limit && !eol(text, j) && !stop(j) && (raw || text[j] !== '&' && text[j] !== '<')) j++;
      out.push(this.take('XmlTextLiteralToken', j - this.i, text.slice(this.i, j)));
    }
    return out;
  }
  /** Element content: text runs, child elements, CDATA sections, comments and processing instructions. Stops at `</` inside an element. */
  content(inElement) {
    const nodes = [], text = this.text;
    const construct = j => text[j] === '<' && (nameStart.test(text[j + 1] ?? '') || text.startsWith('<!--', j) || text.startsWith('<![CDATA[', j) || text[j + 1] === '?' || inElement && text[j + 1] === '/');
    while (!this.done) {
      if (!construct(this.i)) { nodes.push(this.node('XmlText', this.textTokens(construct, false))); continue; }
      if (text[this.i + 1] === '/') break;
      nodes.push(this.at('<!--') ? this.delimited('XmlComment', 'XmlCommentStartToken', 4, '-->', 'XmlCommentEndToken') : this.at('<![CDATA[') ? this.delimited('XmlCDataSection', 'XmlCDataStartToken', 9, ']]>', 'XmlCDataEndToken')
        : text[this.i + 1] === '?' ? this.processingInstruction() : this.element());
    }
    return nodes;
  }
  closing(close, kind) { if (this.at(close)) return this.take(kind, close.length); this.warn(this.i, this.i); return this.missing(kind); }
  delimited(kind, startKind, startLength, close, endKind) {
    const start = this.take(startKind, startLength), text = this.text, tokens = this.textTokens(j => text.startsWith(close, j), true);
    return this.node(kind, start, tokens, this.closing(close, endKind));
  }
  processingInstruction() {
    const start = this.take('XmlProcessingInstructionStartToken', 2), name = this.xmlName(), text = this.text, tokens = this.textTokens(j => text.startsWith('?>', j), true);
    return this.node('XmlProcessingInstruction', start, name, tokens, this.closing('?>', 'XmlProcessingInstructionEndToken'));
  }
  xmlIdentifier() { const text = this.text; let j = this.i; while (j < this.limit && nameChar.test(text[j])) j++; return this.take('IdentifierToken', j - this.i, text.slice(this.i, j)); }
  /** An element or attribute name with an optional `prefix:`. */
  xmlName() {
    const text = this.text;
    if (this.done || !nameStart.test(text[this.i])) { this.warn(this.i, this.i); return this.node('XmlName', null, this.missing('IdentifierToken')); }
    const first = this.xmlIdentifier();
    if (text[this.i] === ':' && this.i + 1 < this.limit && nameStart.test(text[this.i + 1])) return this.node('XmlName', this.node('XmlPrefix', first, this.take('ColonToken', 1)), this.xmlIdentifier());
    return this.node('XmlName', null, first);
  }
  /** Whitespace and line breaks inside a tag become trivia of the next token; a line break is followed by the comment exterior. */
  tagTrivia() {
    const text = this.text;
    for (;;) {
      let j = this.i; while (j < this.limit && isSpace(text[j])) j++;
      if (j > this.i) { this.trivia('WhitespaceTrivia', this.i, j); this.i = j; }
      const n = j < this.limit ? eol(text, j) : 0; if (!n) return;
      this.trivia('EndOfLineTrivia', j, j + n); this.i = j + n; this.exterior();
    }
  }
  element() {
    const text = this.text, lessThan = this.take('LessThanToken', 1), name = this.xmlName(), elementName = name.children[1].text, attributes = [], seen = new Set();
    for (;;) {
      this.tagTrivia(); if (this.done || text[this.i] === '>' || this.at('/>') || text[this.i] === '<') break;
      if (!nameStart.test(text[this.i])) {
        let j = this.i + 1; while (j < this.limit && !isSpace(text[j]) && !eol(text, j) && text[j] !== '>' && text[j] !== '/' && text[j] !== '<') j++;
        this.warn(this.i, j); this.trivia('SkippedTokensTrivia', this.i, j); this.i = j; continue;
      }
      const start = this.i, attribute = this.attribute(elementName), key = (attribute.children[0].children[0]?.children[0].text ?? '') + ':' + attribute.children[0].children[1].text;
      if (seen.has(key)) this.warn(start, this.i); seen.add(key); attributes.push(attribute);
    }
    if (this.at('/>')) return this.node('XmlEmptyElement', lessThan, name, attributes, this.take('SlashGreaterThanToken', 2));
    if (this.done || text[this.i] !== '>' || ++this.depth > 64) { this.warn(this.i, this.i); return this.node('XmlEmptyElement', lessThan, name, attributes, this.missing('SlashGreaterThanToken')); }
    const startTag = this.node('XmlElementStartTag', lessThan, name, attributes, this.take('GreaterThanToken', 1)), content = this.content(true); let endTag;
    if (this.at('</')) {
      const open = this.take('LessThanSlashToken', 2); this.tagTrivia(); const at = this.i, endName = this.xmlName(); if (endName.children[1].text !== elementName) this.warn(at, Math.max(at, this.i));
      this.tagTrivia(); endTag = this.node('XmlElementEndTag', open, endName, this.closing('>', 'GreaterThanToken'));
    } else { this.warn(this.i, this.i); endTag = this.node('XmlElementEndTag', this.missing('LessThanSlashToken'), this.node('XmlName', null, this.missing('IdentifierToken')), this.missing('GreaterThanToken')); }
    this.depth--; return this.node('XmlElement', startTag, content, endTag);
  }
  attribute(elementName) {
    const text = this.text, name = this.xmlName(), attributeName = name.children[0] ? null : name.children[1].text; this.tagTrivia();
    let equals; if (!this.done && text[this.i] === '=') equals = this.take('EqualsToken', 1); else { this.warn(this.i, this.i); equals = this.missing('EqualsToken'); }
    this.tagTrivia(); const quote = this.done ? '' : text[this.i];
    if (quote !== '"' && quote !== "'") { this.warn(this.i, this.i); return this.node('XmlTextAttribute', name, equals, this.missing('DoubleQuoteToken'), null, this.missing('DoubleQuoteToken')); }
    const quoteKind = quote === '"' ? 'DoubleQuoteToken' : 'SingleQuoteToken', open = this.take(quoteKind, 1);
    // `cref="T:Name"` is a verbatim documentation id, kept as text.
    if (attributeName === 'cref' && !(text[this.i + 1] === ':' && text[this.i] !== ':')) { const cref = this.cref(quote); return this.node('XmlCrefAttribute', name, equals, open, cref, this.closing(quote, quoteKind)); }
    if (attributeName === 'name' && nameElements.has(elementName)) {
      this.crefEnd = this.valueEnd(quote); const word = this.peekWord(), identifier = this.node('IdentifierName', word ? this.take('IdentifierToken', word.length, word.replace(/^@/, '')) : this.missing('IdentifierToken'));
      this.crefSpace(); if (!word || this.i < this.crefEnd) { this.warn(this.i, this.crefEnd); this.trivia('SkippedTokensTrivia', this.i, this.crefEnd); this.i = this.crefEnd; }
      return this.node('XmlNameAttribute', name, equals, open, identifier, this.closing(quote, quoteKind));
    }
    const tokens = this.textTokens(j => text[j] === quote, false);
    return this.node('XmlTextAttribute', name, equals, open, tokens, this.closing(quote, quoteKind));
  }
  // ---- cref syntax ------------------------------------------------------------------------------------------------
  /** End of an attribute value parsed as syntax: the closing quote, or the end of the line when it is missing. */
  valueEnd(quote) { const text = this.text; let end = this.i; while (end < this.limit && text[end] !== quote && !eol(text, end)) end++; return end; }
  crefSpace() { const text = this.text; let j = this.i; while (j < this.crefEnd && isSpace(text[j])) j++; if (j > this.i) { this.trivia('WhitespaceTrivia', this.i, j); this.i = j; } }
  /** The identifier or keyword at the cursor (after whitespace), or null. */
  peekWord() { this.crefSpace(); const m = identifierAt.exec(this.text.slice(this.i, this.crefEnd)); return m ? m[0] : null; }
  /** The punctuation character at `j` with `{`, `}` and the `&lt;` `&gt;` `&amp;` entities decoded: { ch, length } or null. */
  crefChar(j) {
    const text = this.text; if (j >= this.crefEnd) return null; const ch = text[j];
    if (ch === '{') return { ch: '<', length: 1 }; if (ch === '}') return { ch: '>', length: 1 };
    if (ch === '&') { const m = /^&(lt|gt|amp);/.exec(text.slice(j, Math.min(this.crefEnd, j + 5))); if (m) return { ch: entities[m[1]], length: m[0].length }; }
    return { ch, length: 1 };
  }
  crefIs(ch) { this.crefSpace(); return this.crefChar(this.i)?.ch === ch; }
  crefPunct(kind) { const c = this.crefChar(this.i); return this.take(kind, c.length, c.ch); }
  crefExpect(ch, kind) { if (this.crefIs(ch)) return this.crefPunct(kind); this.crefBad = true; return this.missing(kind); }
  crefIdentifier() { const word = this.peekWord(); if (!word || crefKeywords.has(word)) { this.crefBad = true; return this.missing('IdentifierToken'); } return this.take('IdentifierToken', word.length, word.replace(/^@/, '')); }
  /** IdentifierName or GenericName; type arguments are written `{T}` (or with `&lt;` `&gt;`). */
  crefSimpleName() {
    const identifier = this.crefIdentifier(); if (!this.crefIs('<')) return this.node('IdentifierName', identifier);
    const open = this.crefPunct('LessThanToken'), args = [];
    for (;;) { args.push(this.crefType()); if (this.crefIs(',')) args.push(this.crefPunct('CommaToken')); else break; }
    return this.node('GenericName', identifier, this.node('TypeArgumentList', open, args, this.crefExpect('>', 'GreaterThanToken')));
  }
  crefNamePart() {
    const word = this.peekWord();
    if (word && this.text.startsWith('::', this.i + word.length) && this.i + word.length + 2 <= this.crefEnd) {
      const alias = this.node('IdentifierName', word === 'global' ? this.take('GlobalKeyword', 6) : this.take('IdentifierToken', word.length, word));
      return this.node('AliasQualifiedName', alias, this.take('ColonColonToken', 2), this.crefSimpleName());
    }
    return this.crefSimpleName();
  }
  crefPredefined() { const word = this.peekWord(); return word && predefinedTypes.has(word) ? this.node('PredefinedType', this.take(reservedKeywordKinds[word], word.length)) : null; }
  crefType() {
    if (++this.depth > 64) { this.depth--; this.crefBad = true; return this.node('IdentifierName', this.missing('IdentifierToken')); }
    let type = this.crefPredefined();
    if (!type) { type = this.crefNamePart(); while (this.crefIs('.')) { const dot = this.crefPunct('DotToken'); type = this.node('QualifiedName', type, dot, this.crefSimpleName()); } }
    this.depth--; return this.crefTypeSuffix(type);
  }
  crefTypeSuffix(type) {
    const omitted = () => this.node('OmittedArraySizeExpression', new GreenToken('OmittedArraySizeExpressionToken', '', undefined));
    for (;;) {
      if (this.crefIs('?')) type = this.node('NullableType', type, this.crefPunct('QuestionToken'));
      else if (this.crefIs('*')) type = this.node('PointerType', type, this.crefPunct('AsteriskToken'));
      else if (this.crefIs('[')) {
        const ranks = [];
        while (this.crefIs('[')) { const open = this.crefPunct('OpenBracketToken'), sizes = [omitted()]; while (this.crefIs(',')) sizes.push(this.crefPunct('CommaToken'), omitted()); ranks.push(this.node('ArrayRankSpecifier', open, sizes, this.crefExpect(']', 'CloseBracketToken'))); }
        type = this.node('ArrayType', type, ranks);
      } else return type;
    }
  }
  crefParameters(open, close, kind) {
    if (!this.crefIs(open)) return null;
    const openToken = this.crefPunct(punctuationKinds[open]), list = [];
    while (!this.crefIs(close) && this.i < this.crefEnd) {
      const word = this.peekWord(); let refKind = null, readOnly = null;
      if (word === 'ref' || word === 'out' || word === 'in') { refKind = this.take(reservedKeywordKinds[word], word.length); if (this.peekWord() === 'readonly') readOnly = this.take('ReadOnlyKeyword', 8); }
      list.push(this.node('CrefParameter', refKind, readOnly, this.crefType()));
      if (this.crefIs(',')) list.push(this.crefPunct('CommaToken')); else break;
    }
    return this.node(kind, openToken, list, this.crefExpect(close, punctuationKinds[close]));
  }
  crefOperator() {
    const word = this.peekWord(); if (word === 'true' || word === 'false') return this.take(reservedKeywordKinds[word], word.length);
    let decoded = '', j = this.i; const ends = [];
    while (decoded.length < 4) { const c = this.crefChar(j); if (!c || !'+-!~*/%&|^<>='.includes(c.ch)) break; decoded += c.ch; j += c.length; ends.push(j); }
    for (const op of crefOperators) if (decoded.startsWith(op)) return this.take(punctuationKinds[op], ends[op.length - 1] - this.i, op);
    this.crefBad = true; return this.missing('PlusToken');
  }
  /** `this[...]`, `operator +(...)` and `implicit operator T(...)` members; null when the cursor is at none of them. */
  crefMember() {
    const word = this.peekWord();
    if (word === 'this') return this.node('IndexerMemberCref', this.take('ThisKeyword', 4), this.crefParameters('[', ']', 'CrefBracketedParameterList'));
    const checkedKeyword = () => this.peekWord() === 'checked' ? this.take('CheckedKeyword', 7) : null;
    if (word === 'operator') { const keyword = this.take('OperatorKeyword', 8), checked = checkedKeyword(); return this.node('OperatorMemberCref', keyword, checked, this.crefOperator(), this.crefParameters('(', ')', 'CrefParameterList')); }
    if (word === 'implicit' || word === 'explicit') {
      const direction = this.take(reservedKeywordKinds[word], 8); let keyword; if (this.peekWord() === 'operator') keyword = this.take('OperatorKeyword', 8); else { this.crefBad = true; keyword = this.missing('OperatorKeyword'); }
      const checked = checkedKeyword(), type = this.crefType(); return this.node('ConversionOperatorMemberCref', direction, keyword, checked, type, this.crefParameters('(', ')', 'CrefParameterList'));
    }
    return null;
  }
  nameMember(name) { return this.node('NameMemberCref', name, this.crefParameters('(', ')', 'CrefParameterList')); }
  cref(quote) {
    const start = this.i, end = this.crefEnd = this.valueEnd(quote); this.crefBad = false;
    let result = this.crefMember();
    const predefined = result ? null : this.crefPredefined();
    if (predefined) {
      if (this.crefIs('.')) { const dot = this.crefPunct('DotToken'); result = this.node('QualifiedCref', predefined, dot, this.crefMember() ?? this.nameMember(this.crefSimpleName())); }
      else result = this.node('TypeCref', this.crefTypeSuffix(predefined));
    } else if (!result) {
      let container = null, dot = null, name = this.crefNamePart();
      while (this.crefIs('.')) {
        const next = this.crefPunct('DotToken'); container = container ? this.node('QualifiedName', container, dot, name) : name; dot = next;
        const member = this.crefMember(); if (member) { result = this.node('QualifiedCref', container, dot, member); break; }
        name = this.crefSimpleName();
      }
      if (!result) {
        if (!container && (this.crefIs('?') || this.crefIs('*') || this.crefIs('['))) result = this.node('TypeCref', this.crefTypeSuffix(name));
        else { const member = this.nameMember(name); result = container ? this.node('QualifiedCref', container, dot, member) : member; }
      }
    }
    this.crefSpace(); if (this.i < end) { this.crefBad = true; this.trivia('SkippedTokensTrivia', this.i, end); this.i = end; }
    if (this.crefBad) this.warn(start, end, 'CS1584', 'XML comment has syntactically incorrect cref attribute');
    return result;
  }
  parse() {
    this.exterior(); const content = this.content(false);
    while (!this.done) content.push(this.node('XmlText', this.textTokens(() => false, false)));
    if (this.limit < this.text.length) this.trivia('DocumentationCommentExteriorTrivia', this.limit, this.text.length);
    return { green: this.node(this.kind, content, this.take('EndOfDocumentationCommentToken', 0)), diagnostics: Object.freeze(this.diagnostics) };
  }
}
/**
 * Parses the text of a documentation comment trivia. `kind` is SingleLineDocumentationCommentTrivia or
 * MultiLineDocumentationCommentTrivia. Returns { green, diagnostics } where `green` is a node of that kind whose
 * full text equals `text` and diagnostics are { code, start, end, message, severity } with offsets into `text`.
 */
export function parseDocumentationComment(text, kind = text.startsWith('/**') ? 'MultiLineDocumentationCommentTrivia' : 'SingleLineDocumentationCommentTrivia') { return new DocumentationCommentParser(text, kind).parse(); }
const structures = new WeakMap();
/** The parsed structure of a documentation comment GreenTrivia (cached per trivia), or null for other trivia. */
export function documentationCommentStructure(trivia) {
  if (!documentationCommentKinds.has(trivia.kind)) return null;
  let parsed = structures.get(trivia); if (!parsed) structures.set(trivia, parsed = parseDocumentationComment(trivia.text, trivia.kind));
  return parsed;
}
