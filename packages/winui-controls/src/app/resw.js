import { ControlError } from '../policy/events.js';

function decode(value) {
  return value.replace(/&([^;]+);/g, (match, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(named, entity)) return named[entity];
    const number = /^#x[0-9a-f]+$/i.test(entity) ? Number.parseInt(entity.slice(2), 16)
      : /^#[0-9]+$/.test(entity) ? Number.parseInt(entity.slice(1), 10) : NaN;
    if (!Number.isInteger(number) || number <= 0 || number > 0x10ffff || number >= 0xd800 && number <= 0xdfff) {
      throw new ControlError('SFUI1693', 'Unsupported or invalid resource XML entity');
    }
    return String.fromCodePoint(number);
  });
}

/** Import string .resw data without resolving external entities or evaluating XML content. */
export function importResw(text, { maximumBytes = 4 * 1024 * 1024, maximumEntries = 100_000 } = {}) {
  if (typeof text !== 'string' || text.length > maximumBytes || new TextEncoder().encode(text).length > maximumBytes) {
    throw new ControlError('SFUI1693', 'Resource XML exceeds its size budget');
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new ControlError('SFUI1693', 'Resource XML must not declare external entities');
  if (text.includes('\0')) throw new ControlError('SFUI1693', 'Resource XML contains an invalid null character');
  const resources = Object.create(null);
  const literals = [];
  const protectedText = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (match, value) => {
    const index = literals.push(value) - 1;
    return '\0' + index + '\0';
  });
  const xml = protectedText.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?xml[\s\S]*?\?>/g, '');
  if (!/^\s*<root(?:\s[^>]*)?>[\s\S]*<\/root>\s*$/.test(xml)) throw new ControlError('SFUI1693', 'Expected a .resw root element');
  const entries = xml.matchAll(/<data\b([^>]*)>([\s\S]*?)<\/data>/g);
  let count = 0;
  for (const entry of entries) {
    if (++count > maximumEntries) throw new ControlError('SFUI1693', 'Resource entry limit exceeded');
    const attribute = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(entry[1]);
    if (!attribute) throw new ControlError('SFUI1693', 'Resource data requires a name');
    const name = decode(attribute[1] ?? attribute[2]);
    if (!name || name.length > 1024 || Object.hasOwn(resources, name)) throw new ControlError('SFUI1693', 'Invalid or duplicate resource name');
    const value = /<value\s*>([\s\S]*?)<\/value>/.exec(entry[2]);
    if (!value) throw new ControlError('SFUI1693', 'Resource data requires a string value');
    const content = value[1];
    if (content.includes('<') || (entry[2].match(/<value\s*>/g) ?? []).length !== 1) {
      throw new ControlError('SFUI1693', 'Resource data requires one text or CDATA value');
    }
    resources[name] = content.split(/(\0\d+\0)/).map(part => part.startsWith('\0')
      ? literals[Number(part.slice(1, -1))] : decode(part)).join('');
  }
  if ((xml.match(/<data\b/g) ?? []).length !== count) throw new ControlError('SFUI1693', 'Malformed resource data element');
  return resources;
}

export function languageFallbacks(language) {
  const canonical = Intl.getCanonicalLocales(language)[0];
  const result = [];
  let value = canonical;
  while (value) {
    result.push(value);
    const separator = value.lastIndexOf('-');
    value = separator < 0 ? '' : value.slice(0, separator);
  }
  return result;
}
