import { GreenToken } from '../green.js';
import { reservedKeywordKinds, predefinedTypes } from './keywords.js';
import { punctuationKinds } from './operators.js';
import { DocumentationCommentReader, xmlEntities, isSpace, eol } from './doc-comment-reader.js';
/**
 * The syntax inside `cref="..."` attributes of documentation comments: qualified and generic names (`List{T}`),
 * members with parameter lists, indexers (`this[int]`), operators and conversion operators, shaped like Roslyn's
 * CrefSyntax nodes. Whitespace is leading trivia of the next token; a malformed cref reports CS1584.
 */
const identifierAt = /^@?[\p{L}_][\p{L}\p{Nd}_]*/u;
const crefKeywords = new Set([
  ...predefinedTypes,
  'this',
  'operator',
  'implicit',
  'explicit',
  'checked',
  'ref',
  'out',
  'in',
  'readonly',
  'true',
  'false'
]);
const crefOperators = [
  '>>>=',
  '>>>',
  '>>=',
  '<<=',
  '>>',
  '<<',
  '==',
  '!=',
  '<=',
  '>=',
  '++',
  '--',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^='
].concat(['+', '-', '!', '~', '*', '/', '%', '&', '|', '^', '<', '>']);
export class DocumentationCommentCrefParser extends DocumentationCommentReader {
  /** End of an attribute value parsed as syntax: the closing quote, or the end of the line when it is missing. */
  valueEnd(quote) {
    const text = this.text;
    let end = this.i;
    while (end < this.limit && text[end] !== quote && !eol(text, end)) end++;
    return end;
  }
  crefSpace() {
    const text = this.text;
    let j = this.i;
    while (j < this.crefEnd && isSpace(text[j])) j++;
    if (j > this.i) {
      this.trivia('WhitespaceTrivia', this.i, j);
      this.i = j;
    }
  }
  /** The identifier or keyword at the cursor (after whitespace), or null. */
  peekWord() {
    this.crefSpace();
    const m = identifierAt.exec(this.text.slice(this.i, this.crefEnd));
    return m ? m[0] : null;
  }
  /** The punctuation character at `j` with `{`, `}` and the `&lt;` `&gt;` `&amp;` entities decoded: { ch, length } or null. */
  crefChar(j) {
    const text = this.text;
    if (j >= this.crefEnd) return null;
    const ch = text[j];
    if (ch === '{') return { ch: '<', length: 1 };
    if (ch === '}') return { ch: '>', length: 1 };
    if (ch === '&') {
      const m = /^&(lt|gt|amp);/.exec(text.slice(j, Math.min(this.crefEnd, j + 5)));
      if (m) return { ch: xmlEntities[m[1]], length: m[0].length };
    }
    return { ch, length: 1 };
  }
  crefIs(ch) {
    this.crefSpace();
    return this.crefChar(this.i)?.ch === ch;
  }
  crefPunct(kind) {
    const c = this.crefChar(this.i);
    return this.take(kind, c.length, c.ch);
  }
  crefExpect(ch, kind) {
    if (this.crefIs(ch)) return this.crefPunct(kind);
    this.crefBad = true;
    return this.missing(kind);
  }
  crefIdentifier() {
    const word = this.peekWord();
    if (!word || crefKeywords.has(word)) {
      this.crefBad = true;
      return this.missing('IdentifierToken');
    }
    return this.take('IdentifierToken', word.length, word.replace(/^@/, ''));
  }
  /** IdentifierName or GenericName; type arguments are written `{T}` (or with `&lt;` `&gt;`). */
  crefSimpleName() {
    const identifier = this.crefIdentifier();
    if (!this.crefIs('<')) return this.node('IdentifierName', identifier);
    const open = this.crefPunct('LessThanToken'),
      args = [];
    for (;;) {
      args.push(this.crefType());
      if (this.crefIs(',')) args.push(this.crefPunct('CommaToken'));
      else break;
    }
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
  crefPredefined() {
    const word = this.peekWord();
    return word && predefinedTypes.has(word) ? this.node('PredefinedType', this.take(reservedKeywordKinds[word], word.length)) : null;
  }
  crefType() {
    if (++this.depth > 64) {
      this.depth--;
      this.crefBad = true;
      return this.node('IdentifierName', this.missing('IdentifierToken'));
    }
    let type = this.crefPredefined();
    if (!type) {
      type = this.crefNamePart();
      while (this.crefIs('.')) {
        const dot = this.crefPunct('DotToken');
        type = this.node('QualifiedName', type, dot, this.crefSimpleName());
      }
    }
    this.depth--;
    return this.crefTypeSuffix(type);
  }
  crefTypeSuffix(type) {
    const omitted = () => this.node('OmittedArraySizeExpression', new GreenToken('OmittedArraySizeExpressionToken', '', undefined));
    for (;;) {
      if (this.crefIs('?')) type = this.node('NullableType', type, this.crefPunct('QuestionToken'));
      else if (this.crefIs('*')) type = this.node('PointerType', type, this.crefPunct('AsteriskToken'));
      else if (this.crefIs('[')) {
        const ranks = [];
        while (this.crefIs('[')) {
          const open = this.crefPunct('OpenBracketToken'),
            sizes = [omitted()];
          while (this.crefIs(',')) sizes.push(this.crefPunct('CommaToken'), omitted());
          ranks.push(this.node('ArrayRankSpecifier', open, sizes, this.crefExpect(']', 'CloseBracketToken')));
        }
        type = this.node('ArrayType', type, ranks);
      } else return type;
    }
  }
  crefParameters(open, close, kind) {
    if (!this.crefIs(open)) return null;
    const openToken = this.crefPunct(punctuationKinds[open]),
      list = [];
    while (!this.crefIs(close) && this.i < this.crefEnd) {
      const word = this.peekWord();
      let refKind = null,
        readOnly = null;
      if (word === 'ref' || word === 'out' || word === 'in') {
        refKind = this.take(reservedKeywordKinds[word], word.length);
        if (this.peekWord() === 'readonly') readOnly = this.take('ReadOnlyKeyword', 8);
      }
      list.push(this.node('CrefParameter', refKind, readOnly, this.crefType()));
      if (this.crefIs(',')) list.push(this.crefPunct('CommaToken'));
      else break;
    }
    return this.node(kind, openToken, list, this.crefExpect(close, punctuationKinds[close]));
  }
  crefOperator() {
    const word = this.peekWord();
    if (word === 'true' || word === 'false') return this.take(reservedKeywordKinds[word], word.length);
    let decoded = '',
      j = this.i;
    const ends = [];
    while (decoded.length < 4) {
      const c = this.crefChar(j);
      if (!c || !'+-!~*/%&|^<>='.includes(c.ch)) break;
      decoded += c.ch;
      j += c.length;
      ends.push(j);
    }
    for (const op of crefOperators) if (decoded.startsWith(op)) return this.take(punctuationKinds[op], ends[op.length - 1] - this.i, op);
    this.crefBad = true;
    return this.missing('PlusToken');
  }
  /** `this[...]`, `operator +(...)` and `implicit operator T(...)` members; null when the cursor is at none of them. */
  crefMember() {
    const word = this.peekWord();
    if (word === 'this')
      return this.node('IndexerMemberCref', this.take('ThisKeyword', 4), this.crefParameters('[', ']', 'CrefBracketedParameterList'));
    const checkedKeyword = () => (this.peekWord() === 'checked' ? this.take('CheckedKeyword', 7) : null);
    if (word === 'operator') {
      const keyword = this.take('OperatorKeyword', 8),
        checked = checkedKeyword();
      return this.node('OperatorMemberCref', keyword, checked, this.crefOperator(), this.crefParameters('(', ')', 'CrefParameterList'));
    }
    if (word === 'implicit' || word === 'explicit') {
      const direction = this.take(reservedKeywordKinds[word], 8);
      let keyword;
      if (this.peekWord() === 'operator') keyword = this.take('OperatorKeyword', 8);
      else {
        this.crefBad = true;
        keyword = this.missing('OperatorKeyword');
      }
      const checked = checkedKeyword(),
        type = this.crefType();
      return this.node('ConversionOperatorMemberCref', direction, keyword, checked, type, this.crefParameters('(', ')', 'CrefParameterList'));
    }
    return null;
  }
  nameMember(name) {
    return this.node('NameMemberCref', name, this.crefParameters('(', ')', 'CrefParameterList'));
  }
  cref(quote) {
    const start = this.i,
      end = (this.crefEnd = this.valueEnd(quote));
    this.crefBad = false;
    let result = this.crefMember();
    const predefined = result ? null : this.crefPredefined();
    if (predefined) {
      if (this.crefIs('.')) {
        const dot = this.crefPunct('DotToken');
        result = this.node('QualifiedCref', predefined, dot, this.crefMember() ?? this.nameMember(this.crefSimpleName()));
      } else result = this.node('TypeCref', this.crefTypeSuffix(predefined));
    } else if (!result) {
      let container = null,
        dot = null,
        name = this.crefNamePart();
      while (this.crefIs('.')) {
        const next = this.crefPunct('DotToken');
        container = container ? this.node('QualifiedName', container, dot, name) : name;
        dot = next;
        const member = this.crefMember();
        if (member) {
          result = this.node('QualifiedCref', container, dot, member);
          break;
        }
        name = this.crefSimpleName();
      }
      if (!result) {
        if (!container && (this.crefIs('?') || this.crefIs('*') || this.crefIs('['))) result = this.node('TypeCref', this.crefTypeSuffix(name));
        else {
          const member = this.nameMember(name);
          result = container ? this.node('QualifiedCref', container, dot, member) : member;
        }
      }
    }
    this.crefSpace();
    if (this.i < end) {
      this.crefBad = true;
      this.trivia('SkippedTokensTrivia', this.i, end);
      this.i = end;
    }
    if (this.crefBad) this.warn(start, end, 'CS1584', 'XML comment has syntactically incorrect cref attribute');
    return result;
  }
}
