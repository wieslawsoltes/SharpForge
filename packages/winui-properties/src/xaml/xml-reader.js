import {XamlParseException} from './diagnostics.js';

export const XAML_NAMESPACE = 'http://schemas.microsoft.com/winfx/2006/xaml';
export const PRESENTATION_NAMESPACE = 'http://schemas.microsoft.com/winfx/2006/xaml/presentation';
export const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
export const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';
export const COMPATIBILITY_NAMESPACE = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

export const defaultXamlLimits = Object.freeze({
  maxBytes: 8 * 1024 * 1024, maxNodes: 200000, maxDepth: 256,
  maxAttributes: 256, maxTextLength: 1024 * 1024, maxNameLength: 1024
});

/** Position-aware, namespace-aware XML tokenizer with no external entities, DTDs or code activation. */
export class XamlXmlReader {
  constructor(text, {limits = {}, signal = null} = {}) {
    if (typeof text !== 'string') throw new TypeError('XAML input must be a string.');
    this.text = text;
    this.limits = {...defaultXamlLimits, ...limits};
    this.signal = signal;
    this.offset = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    this.line = 1;
    this.column = 1;
    this.nodes = [];
    this.stack = [];
    this.roots = 0;
    this.namePattern = /[A-Za-z_\u0080-\uffff][A-Za-z_0-9.\-:\u0080-\uffff]*/y;
    if (text.length * 2 > this.limits.maxBytes) this.fail('SFXAML001', 'XAML input byte budget exceeded.');
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(text)) this.fail('SFXAML034', 'Illegal XML character.');
  }

  position() { return {start: this.offset, length: 0, line: this.line, column: this.column}; }

  fail(code, message, span = this.position()) { throw new XamlParseException(code, message, span); }

  advance(length) {
    const end = this.offset + length;
    while (this.offset < end) {
      const char = this.text[this.offset++];
      if (char === '\r') { this.line++; this.column = 1; }
      else if (char === '\n') {
        if (this.text[this.offset - 2] !== '\r') this.line++;
        this.column = 1;
      } else this.column++;
    }
  }

  whitespace() {
    while (this.offset < this.text.length && /[\t\n\r ]/.test(this.text[this.offset])) this.advance(1);
  }

  name() {
    this.namePattern.lastIndex = this.offset;
    const match = this.namePattern.exec(this.text);
    if (!match || match[0].length > this.limits.maxNameLength || match[0].split(':').length > 2 ||
      match[0].split(':').some(part => !/^[A-Za-z_\u0080-\ufffd]/.test(part))) {
      this.fail('SFXAML002', 'Invalid XML name.');
    }
    this.advance(match[0].length);
    return match[0];
  }

  emit(node, start) {
    if (this.nodes.length >= this.limits.maxNodes) this.fail('SFXAML003', 'XAML node budget exceeded.', start);
    node.span = {...start, length: this.offset - start.start};
    this.nodes.push(node);
  }

  /** The node stream retains original qualified names, attribute source spans and ignorable namespace URIs. */
  read() {
    while (this.offset < this.text.length) {
      this.signal?.throwIfAborted();
      if (this.text[this.offset] !== '<') this.readText();
      else if (this.text.startsWith('<!--', this.offset)) this.readComment();
      else if (this.text.startsWith('<![CDATA[', this.offset)) this.readCdata();
      else if (this.text.startsWith('<?', this.offset)) this.readProcessingInstruction();
      else if (this.text.startsWith('<!', this.offset)) this.fail('SFXAML004', 'DTD and entity declarations are forbidden.');
      else if (this.text.startsWith('</', this.offset)) this.readEnd();
      else this.readStart();
    }
    if (this.stack.length) this.fail('SFXAML005', 'Unclosed XAML element.');
    if (this.roots !== 1) this.fail('SFXAML006', 'XAML requires exactly one root element.');
    return this.nodes;
  }

  readText() {
    const start = this.position();
    const end = this.text.indexOf('<', this.offset);
    const length = (end < 0 ? this.text.length : end) - this.offset;
    if (length > this.limits.maxTextLength) this.fail('SFXAML007', 'XAML text budget exceeded.', start);
    const raw = this.text.slice(this.offset, this.offset + length);
    if (raw.includes(']]>')) this.fail('SFXAML008', 'CDATA terminators are forbidden in ordinary XML text.', start);
    if (!this.stack.length && raw.trim()) this.fail('SFXAML006', 'Text is not permitted outside the root element.', start);
    const value = this.decode(raw.replace(/\r\n?/g, '\n'), start);
    this.advance(length);
    this.emit({kind: 'text', value, raw, preserveSpace: this.stack.at(-1)?.preserveSpace ?? false}, start);
  }

  readComment() {
    const start = this.position();
    const end = this.text.indexOf('-->', this.offset + 4);
    if (end < 0) this.fail('SFXAML008', 'Unclosed XML comment.', start);
    const value = this.text.slice(this.offset + 4, end);
    if (value.includes('--')) this.fail('SFXAML008', 'XML comments cannot contain a double hyphen.', start);
    this.advance(end + 3 - this.offset);
    this.emit({kind: 'comment', value}, start);
  }

  readCdata() {
    const start = this.position();
    if (!this.stack.length) this.fail('SFXAML006', 'CDATA is not permitted outside the root element.', start);
    const end = this.text.indexOf(']]>', this.offset + 9);
    if (end < 0) this.fail('SFXAML008', 'Unclosed CDATA section.', start);
    const value = this.text.slice(this.offset + 9, end).replace(/\r\n?/g, '\n');
    if (value.length > this.limits.maxTextLength) this.fail('SFXAML007', 'XAML text budget exceeded.', start);
    this.advance(end + 3 - this.offset);
    this.emit({kind: 'text', value, raw: value, preserveSpace: true, cdata: true}, start);
  }

  readProcessingInstruction() {
    const start = this.position();
    const end = this.text.indexOf('?>', this.offset + 2);
    if (end < 0) this.fail('SFXAML008', 'Unclosed XML declaration.', start);
    const value = this.text.slice(this.offset + 2, end);
    if (!/^xml\s+version\s*=\s*['"]1\.0['"](?:\s+[^<>]+)?$/.test(value) || this.nodes.length || this.roots) {
      this.fail('SFXAML009', 'Only an initial XML 1.0 declaration is supported.', start);
    }
    this.advance(end + 2 - this.offset);
    this.emit({kind: 'declaration', value}, start);
  }

  readStart() {
    const start = this.position();
    this.advance(1);
    const qualifiedName = this.name();
    const attributes = this.readAttributes();
    const parent = this.stack.at(-1);
    const namespaces = new Map(parent?.namespaces ?? [['xml', XML_NAMESPACE]]);
    for (const attribute of attributes) {
      if (attribute.qualifiedName === 'xmlns') {
        if ([XML_NAMESPACE, XMLNS_NAMESPACE].includes(attribute.value)) this.fail('SFXAML018', 'Invalid default namespace.', attribute.span);
        namespaces.set('', attribute.value);
      }
      else if (attribute.qualifiedName.startsWith('xmlns:')) this.setNamespace(namespaces, attribute);
    }
    const name = this.resolveName(qualifiedName, namespaces);
    const expanded = new Set();
    for (const attribute of attributes) {
      Object.assign(attribute, this.resolveName(attribute.qualifiedName, namespaces, true));
      const key = attribute.namespace + '|' + attribute.localName;
      if (expanded.has(key)) this.fail('SFXAML010', 'Duplicate expanded attribute name.', attribute.span);
      expanded.add(key);
    }
    const ignorable = new Set(parent?.ignorable ?? []);
    const ignored = attributes.find(attribute => attribute.namespace === COMPATIBILITY_NAMESPACE && attribute.localName === 'Ignorable');
    for (const prefix of ignored?.value.trim().split(/\s+/).filter(Boolean) ?? []) {
      if (!namespaces.has(prefix)) this.fail('SFXAML011', `Unknown ignorable namespace prefix '${prefix}'.`, start);
      ignorable.add(namespaces.get(prefix));
    }
    const space = attributes.find(attribute => attribute.namespace === XML_NAMESPACE && attribute.localName === 'space');
    if (space && !['default', 'preserve'].includes(space.value)) this.fail('SFXAML012', 'xml:space must be default or preserve.', space.span);
    const preserveSpace = space ? space.value === 'preserve' : parent?.preserveSpace ?? false;
    const selfClosing = this.text.startsWith('/>', this.offset);
    if (!selfClosing && this.text[this.offset] !== '>') this.fail('SFXAML013', 'Expected closing angle bracket.');
    this.advance(selfClosing ? 2 : 1);
    const node = {kind: 'startElement', qualifiedName, ...name, attributes, namespaces, ignorable, preserveSpace, selfClosing};
    if (!this.stack.length && ++this.roots > 1) this.fail('SFXAML006', 'Multiple root elements are forbidden.', start);
    this.emit(node, start);
    if (this.stack.length >= this.limits.maxDepth) this.fail('SFXAML014', 'XAML nesting depth budget exceeded.', start);
    if (selfClosing) this.emit({kind: 'endElement', qualifiedName, ...name, selfClosing: true}, start);
    else this.stack.push(node);
  }

  readAttributes() {
    const attributes = [];
    while (this.offset < this.text.length) {
      const before = this.offset;
      this.whitespace();
      if (this.text[this.offset] === '>' || this.text.startsWith('/>', this.offset)) break;
      if (before === this.offset) this.fail('SFXAML015', 'Attributes require separating whitespace.');
      if (attributes.length >= this.limits.maxAttributes) this.fail('SFXAML016', 'Attribute budget exceeded.');
      const start = this.position();
      const qualifiedName = this.name();
      this.whitespace();
      if (this.text[this.offset] !== '=') this.fail('SFXAML017', 'Attribute requires an equals sign.');
      this.advance(1);
      this.whitespace();
      const quote = this.text[this.offset];
      if (quote !== '"' && quote !== "'") this.fail('SFXAML017', 'Attribute values must be quoted.');
      this.advance(1);
      const end = this.text.indexOf(quote, this.offset);
      if (end < 0) this.fail('SFXAML017', 'Unclosed attribute value.', start);
      const raw = this.text.slice(this.offset, end);
      if (raw.includes('<') || raw.length > this.limits.maxTextLength) this.fail('SFXAML017', 'Invalid or oversized attribute value.', start);
      const value = this.decode(raw.replace(/\r\n|[\t\r\n]/g, ' '), start);
      this.advance(end + 1 - this.offset);
      attributes.push({qualifiedName, value, raw, span: {...start, length: this.offset - start.start}});
    }
    return attributes;
  }

  setNamespace(namespaces, attribute) {
    const prefix = attribute.qualifiedName.slice(6);
    if (!attribute.value || prefix === 'xmlns' || attribute.value === XMLNS_NAMESPACE ||
      prefix === 'xml' && attribute.value !== XML_NAMESPACE || prefix !== 'xml' && attribute.value === XML_NAMESPACE) {
      this.fail('SFXAML018', 'Invalid reserved namespace declaration.', attribute.span);
    }
    namespaces.set(prefix, attribute.value);
  }

  resolveName(name, namespaces, attribute = false) {
    if (name === 'xmlns') return {prefix: '', localName: 'xmlns', namespace: XMLNS_NAMESPACE};
    const separator = name.indexOf(':');
    const prefix = separator < 0 ? '' : name.slice(0, separator);
    const localName = separator < 0 ? name : name.slice(separator + 1);
    if (prefix === 'xmlns') return {prefix, localName, namespace: XMLNS_NAMESPACE};
    if (prefix && !namespaces.has(prefix)) this.fail('SFXAML011', `Unbound namespace prefix '${prefix}'.`);
    return {prefix, localName, namespace: prefix ? namespaces.get(prefix) : attribute ? '' : namespaces.get('') ?? ''};
  }

  readEnd() {
    const start = this.position();
    this.advance(2);
    const qualifiedName = this.name();
    this.whitespace();
    if (this.text[this.offset] !== '>') this.fail('SFXAML013', 'Malformed closing element.');
    this.advance(1);
    const parent = this.stack.pop();
    if (!parent || parent.qualifiedName !== qualifiedName) this.fail('SFXAML019', `Mismatched closing element '${qualifiedName}'.`, start);
    this.emit({kind: 'endElement', qualifiedName, namespace: parent.namespace, localName: parent.localName, prefix: parent.prefix}, start);
  }

  decode(raw, span) {
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(raw)) this.fail('SFXAML034', 'Illegal XML control character.', span);
    return raw.replace(/&([^;\s<&]*);?|[\ud800-\udfff]/g, (match, entity, offset) => {
      if (!match.startsWith('&')) {
        const code = raw.charCodeAt(offset);
        const next = raw.charCodeAt(offset + 1);
        const previous = raw.charCodeAt(offset - 1);
        if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff || code >= 0xdc00 && previous >= 0xd800 && previous <= 0xdbff) return match;
        this.fail('SFXAML034', 'Unpaired Unicode surrogate in XML.', span);
      }
      const predefined = {lt: '<', gt: '>', amp: '&', quot: '"', apos: "'"};
      if (!match.endsWith(';')) this.fail('SFXAML035', 'Unterminated XML entity reference.', span);
      if (Object.hasOwn(predefined, entity)) return predefined[entity];
      if (!/^#(?:x[\da-f]+|\d+)$/i.test(entity)) this.fail('SFXAML004', 'Custom XML entity references are forbidden.', span);
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (!Number.isSafeInteger(code) || code > 0x10ffff || code === 0xfffe || code === 0xffff || code >= 0xd800 && code <= 0xdfff ||
        code < 0x20 && ![9, 10, 13].includes(code)) this.fail('SFXAML034', 'Invalid XML character entity.', span);
      return String.fromCodePoint(code);
    });
  }
}

export function readXamlNodes(text, options) { return new XamlXmlReader(text, options).read(); }

/** Build a syntax tree without instantiating any framework objects. */
export function parseXaml(text, options) {
  const nodes = readXamlNodes(text, options);
  const stack = [];
  let root = null;
  for (const node of nodes) {
    if (node.kind === 'startElement') {
      const element = {...node, children: []};
      if (stack.length) stack.at(-1).children.push(element);
      else root = element;
      stack.push(element);
    } else if (node.kind === 'endElement') stack.pop();
    else if (stack.length) stack.at(-1).children.push(node);
  }
  return {root, nodes, source: text};
}
