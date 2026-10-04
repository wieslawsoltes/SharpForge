import {parseXmlCst} from './xml-cst.js';

/** Bounded XML data parser; cst mode retains exact source spans without changing the default data tree. */
export function parseXml(source, {
  maxLength = 2_000_000,
  maxNodes = 20000,
  maxDepth = 64,
  cst = false,
  signal,
} = {}) {
  if (cst) return parseXmlCst(source, {maxLength, maxNodes, maxDepth, signal});
  signal?.throwIfAborted();
  if (typeof source !== 'string' || source.length > maxLength) {
    throw new Error('XML exceeds the text limit');
  }
  return new XmlDataParser(source.replace(/^\uFEFF/, ''), maxNodes, maxDepth).parse();
}

/** Escape the same four XML attribute/text characters after converting the input to a string. */
export const xmlEscape = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

class XmlDataParser {
  constructor(source, maxNodes, maxDepth) {
    this.source = source;
    this.maxNodes = maxNodes;
    this.maxDepth = maxDepth;
    this.root = {name: '#document', attributes: Object.create(null), children: [], text: '', start: 0};
    this.stack = [this.root];
    this.position = 0;
    this.nodes = 0;
  }

  parse() {
    while (this.position < this.source.length) {
      if (this.source.startsWith('<!--', this.position)) {
        this.readComment();
        continue;
      }
      if (this.source.startsWith('<?', this.position)) {
        this.readProcessingInstruction();
        continue;
      }
      if (this.source.startsWith('<![CDATA[', this.position)) {
        this.readCdata();
        continue;
      }
      if (this.source.startsWith('<!', this.position)) {
        this.fail('DTD and entity declarations are not permitted');
      }
      if (this.source.startsWith('</', this.position)) {
        this.readClosingTag();
        continue;
      }
      if (this.source[this.position] === '<') {
        this.readElement();
        continue;
      }
      this.readText();
    }
    if (this.stack.length !== 1 || this.root.children.length !== 1 || this.root.text.trim()) {
      this.fail('XML must contain exactly one complete root');
    }
    return this.root.children[0];
  }

  fail(message) {
    throw new Error(`${message} at XML offset ${this.position}`);
  }

  skipWhitespace() {
    while (/\s/.test(this.source[this.position] ?? '') && this.position < this.source.length) {
      this.position++;
    }
  }

  readName() {
    const match = /^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(this.source.slice(this.position));
    if (!match) this.fail('Expected XML name');
    this.position += match[0].length;
    return match[0];
  }

  decode(value) {
    return value.replace(/&([^;]*);|&/g, (whole, entity) => {
      const predefined = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
      if (Object.hasOwn(predefined, entity)) return predefined[entity];
      if (/^#(?:x[0-9a-f]+|\d+)$/i.test(entity ?? '')) {
        const code = entity[1].toLowerCase() === 'x'
          ? parseInt(entity.slice(2), 16)
          : Number(entity.slice(1));
        if (code === 9 || code === 10 || code === 13 ||
          code >= 32 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) && code !== 0xfffe && code !== 0xffff) {
          return String.fromCodePoint(code);
        }
      }
      this.fail('Unsupported or invalid XML entity');
    });
  }

  readComment() {
    const end = this.source.indexOf('-->', this.position + 4);
    if (end < 0 || this.source.slice(this.position + 4, end).includes('--')) this.fail('Invalid XML comment');
    this.position = end + 3;
  }

  readProcessingInstruction() {
    const end = this.source.indexOf('?>', this.position + 2);
    if (end < 0) this.fail('Unterminated processing instruction');
    this.position = end + 2;
  }

  readCdata() {
    const end = this.source.indexOf(']]>', this.position + 9);
    if (end < 0) this.fail('Unterminated CDATA');
    this.stack.at(-1).text += this.source.slice(this.position + 9, end);
    this.position = end + 3;
  }

  readClosingTag() {
    this.position += 2;
    const closing = this.readName();
    this.skipWhitespace();
    if (this.source[this.position++] !== '>') this.fail('Expected closing >');
    if (this.stack.length === 1 || this.stack.pop().name !== closing) this.fail('Mismatched closing tag');
  }

  readElement() {
    const start = this.position++;
    const tag = this.readName();
    const attributes = Object.create(null);
    let closed = false;
    for (;;) {
      const before = this.position;
      this.skipWhitespace();
      if (this.source.startsWith('/>', this.position)) {
        this.position += 2;
        closed = true;
        break;
      }
      if (this.source[this.position] === '>') {
        this.position++;
        break;
      }
      if (this.position === before) this.fail('Expected attribute separator');
      this.readAttribute(attributes);
    }
    if (++this.nodes > this.maxNodes) this.fail('XML node limit exceeded');
    const node = {name: tag, attributes, children: [], text: '', start};
    this.stack.at(-1).children.push(node);
    if (!closed) {
      if (this.stack.length >= this.maxDepth) this.fail('XML nesting limit exceeded');
      this.stack.push(node);
    }
  }

  readAttribute(attributes) {
    const key = this.readName();
    if (Object.hasOwn(attributes, key)) this.fail('Duplicate XML attribute');
    this.skipWhitespace();
    if (this.source[this.position++] !== '=') this.fail('Expected =');
    this.skipWhitespace();
    const quote = this.source[this.position++];
    if (!['"', "'"].includes(quote)) this.fail('Expected quoted attribute');
    const end = this.source.indexOf(quote, this.position);
    if (end < 0) this.fail('Unterminated attribute');
    const value = this.source.slice(this.position, end);
    if (value.includes('<')) this.fail('Invalid < in attribute');
    attributes[key] = this.decode(value);
    this.position = end + 1;
  }

  readText() {
    let end = this.source.indexOf('<', this.position);
    if (end < 0) end = this.source.length;
    this.stack.at(-1).text += this.decode(this.source.slice(this.position, end));
    this.position = end;
  }
}
