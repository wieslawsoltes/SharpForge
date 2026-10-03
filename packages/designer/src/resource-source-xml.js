import {resourceSourceCheck, resourceSourceFail} from './resource-source-errors.js';

const whitespace = character => character === ' ' || character === '\t' || character === '\r' || character === '\n';
const validCharacter = code => code === 9 || code === 10 || code === 13 || code >= 32 && code <= 0x10ffff
  && !(code >= 0xd800 && code <= 0xdfff) && code !== 0xfffe && code !== 0xffff;
const entities = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};

function decodeResourceEntities(value, start, fail) {
  let result = '';
  for (let index = 0; index < value.length; index++) {
    const code = value.codePointAt(index);
    if (!validCharacter(code)) fail('Invalid XML character.', start + index);
    if (value[index] !== '&') {
      result += String.fromCodePoint(code);
      if (code > 0xffff) index++;
      continue;
    }
    const end = value.indexOf(';', index + 1);
    if (end < 0 || end - index > 16) fail('Unterminated or unsupported XML entity.', start + index);
    const entity = value.slice(index + 1, end);
    if (Object.hasOwn(entities, entity)) result += entities[entity];
    else {
      const hexadecimal = entity.startsWith('#x');
      const digits = entity.slice(hexadecimal ? 2 : 1);
      if (!entity.startsWith('#') || !(hexadecimal ? /^[0-9a-f]+$/i : /^\d+$/).test(digits)) {
        fail('Only predefined and numeric XML entities are supported.', start + index);
      }
      const decoded = Number.parseInt(digits, hexadecimal ? 16 : 10);
      if (!validCharacter(decoded)) fail('Invalid numeric XML entity.', start + index);
      result += String.fromCodePoint(decoded);
    }
    index = end;
  }
  return result;
}

/** An inert, bounded XML subset. It never resolves DTDs, processing instructions, entities, or URLs. */
export function parseResourceMarkup(text, {maxCharacters = 2_000_000, maxNodes = 20000, maxDepth = 64, signal} = {}) {
  let cursor = 0;
  let count = 0;
  const fail = (message, start = cursor) => resourceSourceFail('SFD1887', message,
    {markupSpan: {start, length: Math.max(1, cursor - start)}});
  if (typeof text !== 'string' || text.length > maxCharacters) {
    resourceSourceFail('SFD1881', 'Resource markup exceeds its character limit.');
  }
  const skip = () => { while (whitespace(text[cursor])) cursor++; };
  const name = () => {
    const start = cursor;
    if (!/[A-Za-z_]/.test(text[cursor] ?? '')) fail('Expected a resource markup name.');
    while (/[A-Za-z0-9_.:-]/.test(text[cursor] ?? '')) cursor++;
    return text.slice(start, cursor);
  };
  const decode = (value, start) => decodeResourceEntities(value, start, fail);
  const element = depth => {
    resourceSourceCheck(signal);
    const start = cursor;
    if (depth > maxDepth || ++count > maxNodes) resourceSourceFail('SFD1881', 'Resource markup node or depth limit exceeded.');
    if (text[cursor++] !== '<' || ['!', '?', '/'].includes(text[cursor])) fail('Expected an inert resource element.', start);
    const node = {name: name(), attributes: {}, children: [], text: '', start, end: 0};
    while (cursor < text.length) {
      const before = cursor;
      skip();
      if (text.startsWith('/>', cursor)) {
        cursor += 2;
        node.end = cursor;
        return node;
      }
      if (text[cursor] === '>') {
        cursor++;
        break;
      }
      if (cursor === before) fail('Attributes require whitespace.');
      if (Object.keys(node.attributes).length >= 128) resourceSourceFail('SFD1881', 'Resource attribute limit exceeded.');
      const key = name();
      if (Object.hasOwn(node.attributes, key) || key === '__proto__' || key === 'constructor') fail('Duplicate or invalid attribute.');
      skip();
      if (text[cursor++] !== '=') fail('Expected an attribute assignment.');
      skip();
      const quote = text[cursor++];
      if (quote !== '"' && quote !== "'") fail('Attribute values must be quoted.');
      const valueStart = cursor;
      while (cursor < text.length && text[cursor] !== quote) {
        if (text[cursor] === '<') fail('Literal < is not allowed in attributes.');
        cursor++;
      }
      if (cursor >= text.length) fail('Unterminated attribute.', valueStart);
      node.attributes[key] = decode(text.slice(valueStart, cursor), valueStart);
      cursor++;
    }
    while (cursor < text.length) {
      resourceSourceCheck(signal);
      if (text.startsWith('</', cursor)) {
        cursor += 2;
        if (name() !== node.name) fail('Resource element closing name does not match.');
        skip();
        if (text[cursor++] !== '>') fail('Expected the end of the closing element.');
        node.end = cursor;
        return node;
      }
      if (text[cursor] === '<') node.children.push(element(depth + 1));
      else {
        const valueStart = cursor;
        while (cursor < text.length && text[cursor] !== '<') cursor++;
        node.text += decode(text.slice(valueStart, cursor), valueStart);
      }
    }
    fail('Unterminated resource element.', start);
  };
  skip();
  const root = element(1);
  skip();
  if (cursor !== text.length) fail('Only one resource root is allowed.');
  return root;
}

export function resourceMarkupFail(node, message) {
  resourceSourceFail('SFD1887', message, {markupSpan: {start: node.start, length: node.end - node.start}});
}

export function resourceAttributes(node, allowed) {
  for (const key of Object.keys(node.attributes)) {
    if (!allowed.includes(key)) resourceMarkupFail(node, `Unsupported ${node.name} attribute ${key}.`);
  }
}

export function resourceChildren(node, {text = false, children = false} = {}) {
  if (!text && node.text.trim() || !children && node.children.length) resourceMarkupFail(node, `Unexpected ${node.name} content.`);
}
