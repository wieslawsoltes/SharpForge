import {bounded, fail} from '../host.js';
import {formatBclValue} from './number-format.js';

/** Format released composite items; invalid braces or argument indexes produce managed FormatException. */
export function compositeFormat(platform, format, args) {
  let result = '';
  let index = 0;
  while (index < format.length) {
    const character = format[index++];
    if (character === '{' && format[index] === '{') {
      result += '{';
      index++;
      continue;
    }
    if (character === '}' && format[index] === '}') {
      result += '}';
      index++;
      continue;
    }
    if (character === '}') fail(platform, 'FormatException', 'Unescaped closing format brace');
    if (character !== '{') {
      result += character;
      continue;
    }
    const end = format.indexOf('}', index);
    if (end < 0) fail(platform, 'FormatException', 'Unclosed format item');
    const item = /^(\d+)(?:\s*,\s*(-?\d+))?(?::([^{}]*))?$/.exec(format.slice(index, end));
    if (!item || Number(item[1]) >= args.length) fail(platform, 'FormatException', 'Invalid format argument');
    result += formatBclValue(platform, args[Number(item[1])], item[3] ?? '', Number(item[2] ?? 0));
    index = end + 1;
    bounded(platform, result);
  }
  return bounded(platform, result);
}
