import { DocumentationCommentCrefParser } from './doc-comment-cref.js';
import { isSpace, eol } from './doc-comment-reader.js';
/**
 * Structured XML documentation comments. A `///` or `/** *\/` trivia is parsed on demand into a green tree shaped like
 * Roslyn's DocumentationCommentTriviaSyntax: XmlElement / XmlEmptyElement / XmlText / XmlCDataSection / XmlComment /
 * XmlProcessingInstruction content, text, cref and name attributes, and cref syntax (qualified, generic, operator,
 * conversion and indexer members with parameter lists). Comment exteriors (`///`, `/**`, ` *`, `*\/`) and whitespace
 * inside tags are trivia, so the structure's full text always equals the comment text. Malformed XML reports CS1570
 * and malformed crefs CS1584 as warnings; no character is dropped.
 */
const nameStart = /[\p{L}_]/u;
const nameChar = /[\p{L}\p{Nd}_.\-]/u;
const nameElements = new Set(['param', 'paramref', 'typeparam', 'typeparamref']);
export const documentationCommentKinds = Object.freeze(new Set(['SingleLineDocumentationCommentTrivia', 'MultiLineDocumentationCommentTrivia']));
class DocumentationCommentParser extends DocumentationCommentCrefParser {
  /** Element content: text runs, child elements, CDATA sections, comments and processing instructions. Stops at `</` inside an element. */
  content(inElement) {
    const nodes = [],
      text = this.text;
    const construct = j =>
      text[j] === '<' &&
      (nameStart.test(text[j + 1] ?? '') ||
        text.startsWith('<!--', j) ||
        text.startsWith('<![CDATA[', j) ||
        text[j + 1] === '?' ||
        (inElement && text[j + 1] === '/'));
    while (!this.done) {
      if (!construct(this.i)) {
        nodes.push(this.node('XmlText', this.textTokens(construct, false)));
        continue;
      }
      if (text[this.i + 1] === '/') break;
      nodes.push(
        this.at('<!--')
          ? this.delimited('XmlComment', 'XmlCommentStartToken', 4, '-->', 'XmlCommentEndToken')
          : this.at('<![CDATA[')
            ? this.delimited('XmlCDataSection', 'XmlCDataStartToken', 9, ']]>', 'XmlCDataEndToken')
            : text[this.i + 1] === '?'
              ? this.processingInstruction()
              : this.element()
      );
    }
    return nodes;
  }
  closing(close, kind) {
    if (this.at(close)) return this.take(kind, close.length);
    this.warn(this.i, this.i);
    return this.missing(kind);
  }
  delimited(kind, startKind, startLength, close, endKind) {
    const start = this.take(startKind, startLength),
      text = this.text,
      tokens = this.textTokens(j => text.startsWith(close, j), true);
    return this.node(kind, start, tokens, this.closing(close, endKind));
  }
  processingInstruction() {
    const start = this.take('XmlProcessingInstructionStartToken', 2),
      name = this.xmlName(),
      text = this.text,
      tokens = this.textTokens(j => text.startsWith('?>', j), true);
    return this.node('XmlProcessingInstruction', start, name, tokens, this.closing('?>', 'XmlProcessingInstructionEndToken'));
  }
  xmlIdentifier() {
    const text = this.text;
    let j = this.i;
    while (j < this.limit && nameChar.test(text[j])) j++;
    return this.take('IdentifierToken', j - this.i, text.slice(this.i, j));
  }
  /** An element or attribute name with an optional `prefix:`. */
  xmlName() {
    const text = this.text;
    if (this.done || !nameStart.test(text[this.i])) {
      this.warn(this.i, this.i);
      return this.node('XmlName', null, this.missing('IdentifierToken'));
    }
    const first = this.xmlIdentifier();
    if (text[this.i] === ':' && this.i + 1 < this.limit && nameStart.test(text[this.i + 1]))
      return this.node('XmlName', this.node('XmlPrefix', first, this.take('ColonToken', 1)), this.xmlIdentifier());
    return this.node('XmlName', null, first);
  }
  /** Whitespace and line breaks inside a tag become trivia of the next token; a line break is followed by the comment exterior. */
  tagTrivia() {
    const text = this.text;
    for (;;) {
      let j = this.i;
      while (j < this.limit && isSpace(text[j])) j++;
      if (j > this.i) {
        this.trivia('WhitespaceTrivia', this.i, j);
        this.i = j;
      }
      const n = j < this.limit ? eol(text, j) : 0;
      if (!n) return;
      this.trivia('EndOfLineTrivia', j, j + n);
      this.i = j + n;
      this.exterior();
    }
  }
  element() {
    const text = this.text,
      lessThan = this.take('LessThanToken', 1),
      name = this.xmlName(),
      elementName = name.children[1].text,
      attributes = [],
      seen = new Set();
    for (;;) {
      this.tagTrivia();
      if (this.done || text[this.i] === '>' || this.at('/>') || text[this.i] === '<') break;
      if (!nameStart.test(text[this.i])) {
        let j = this.i + 1;
        while (j < this.limit && !isSpace(text[j]) && !eol(text, j) && text[j] !== '>' && text[j] !== '/' && text[j] !== '<') j++;
        this.warn(this.i, j);
        this.trivia('SkippedTokensTrivia', this.i, j);
        this.i = j;
        continue;
      }
      const start = this.i,
        attribute = this.attribute(elementName),
        key = (attribute.children[0].children[0]?.children[0].text ?? '') + ':' + attribute.children[0].children[1].text;
      if (seen.has(key)) this.warn(start, this.i);
      seen.add(key);
      attributes.push(attribute);
    }
    if (this.at('/>')) return this.node('XmlEmptyElement', lessThan, name, attributes, this.take('SlashGreaterThanToken', 2));
    if (this.done || text[this.i] !== '>' || ++this.depth > 64) {
      this.warn(this.i, this.i);
      return this.node('XmlEmptyElement', lessThan, name, attributes, this.missing('SlashGreaterThanToken'));
    }
    const startTag = this.node('XmlElementStartTag', lessThan, name, attributes, this.take('GreaterThanToken', 1)),
      content = this.content(true);
    let endTag;
    if (this.at('</')) {
      const open = this.take('LessThanSlashToken', 2);
      this.tagTrivia();
      const at = this.i,
        endName = this.xmlName();
      if (endName.children[1].text !== elementName) this.warn(at, Math.max(at, this.i));
      this.tagTrivia();
      endTag = this.node('XmlElementEndTag', open, endName, this.closing('>', 'GreaterThanToken'));
    } else {
      this.warn(this.i, this.i);
      endTag = this.node(
        'XmlElementEndTag',
        this.missing('LessThanSlashToken'),
        this.node('XmlName', null, this.missing('IdentifierToken')),
        this.missing('GreaterThanToken')
      );
    }
    this.depth--;
    return this.node('XmlElement', startTag, content, endTag);
  }
  attribute(elementName) {
    const text = this.text,
      name = this.xmlName(),
      attributeName = name.children[0] ? null : name.children[1].text;
    this.tagTrivia();
    let equals;
    if (!this.done && text[this.i] === '=') equals = this.take('EqualsToken', 1);
    else {
      this.warn(this.i, this.i);
      equals = this.missing('EqualsToken');
    }
    this.tagTrivia();
    const quote = this.done ? '' : text[this.i];
    if (quote !== '"' && quote !== "'") {
      this.warn(this.i, this.i);
      return this.node('XmlTextAttribute', name, equals, this.missing('DoubleQuoteToken'), null, this.missing('DoubleQuoteToken'));
    }
    const quoteKind = quote === '"' ? 'DoubleQuoteToken' : 'SingleQuoteToken',
      open = this.take(quoteKind, 1);
    // `cref="T:Name"` is a verbatim documentation id, kept as text.
    if (attributeName === 'cref' && !(text[this.i + 1] === ':' && text[this.i] !== ':')) {
      const cref = this.cref(quote);
      return this.node('XmlCrefAttribute', name, equals, open, cref, this.closing(quote, quoteKind));
    }
    if (attributeName === 'name' && nameElements.has(elementName)) {
      this.crefEnd = this.valueEnd(quote);
      const word = this.peekWord(),
        identifier = this.node(
          'IdentifierName',
          word ? this.take('IdentifierToken', word.length, word.replace(/^@/, '')) : this.missing('IdentifierToken')
        );
      this.crefSpace();
      if (!word || this.i < this.crefEnd) {
        this.warn(this.i, this.crefEnd);
        this.trivia('SkippedTokensTrivia', this.i, this.crefEnd);
        this.i = this.crefEnd;
      }
      return this.node('XmlNameAttribute', name, equals, open, identifier, this.closing(quote, quoteKind));
    }
    const tokens = this.textTokens(j => text[j] === quote, false);
    return this.node('XmlTextAttribute', name, equals, open, tokens, this.closing(quote, quoteKind));
  }
  parse() {
    this.exterior();
    const content = this.content(false);
    while (!this.done)
      content.push(
        this.node(
          'XmlText',
          this.textTokens(() => false, false)
        )
      );
    if (this.limit < this.text.length) this.trivia('DocumentationCommentExteriorTrivia', this.limit, this.text.length);
    return { green: this.node(this.kind, content, this.take('EndOfDocumentationCommentToken', 0)), diagnostics: Object.freeze(this.diagnostics) };
  }
}
/**
 * Parses the text of a documentation comment trivia. `kind` is SingleLineDocumentationCommentTrivia or
 * MultiLineDocumentationCommentTrivia. Returns { green, diagnostics } where `green` is a node of that kind whose
 * full text equals `text` and diagnostics are { code, start, end, message, severity } with offsets into `text`.
 */
export function parseDocumentationComment(
  text,
  kind = text.startsWith('/**') ? 'MultiLineDocumentationCommentTrivia' : 'SingleLineDocumentationCommentTrivia'
) {
  return new DocumentationCommentParser(text, kind).parse();
}
const structures = new WeakMap();
/** The parsed structure of a documentation comment GreenTrivia (cached per trivia), or null for other trivia. */
export function documentationCommentStructure(trivia) {
  if (!documentationCommentKinds.has(trivia.kind)) return null;
  let parsed = structures.get(trivia);
  if (!parsed) structures.set(trivia, (parsed = parseDocumentationComment(trivia.text, trivia.kind)));
  return parsed;
}
