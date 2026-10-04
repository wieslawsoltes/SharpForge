import {DrawingError, finite} from '../drawing/commands.js';

const argumentCounts = Object.freeze({M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7});

/** Bounded SVG/WinUI path mini-language scanner with exact character offsets. */
function tokenize(source, limit) {
  const tokens = [];
  const numberPattern = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  let offset = 0;
  let command = '';
  let argument = 0;
  let comma = null;
  while (offset < source.length) {
    const character = source[offset];
    if (/\s/.test(character)) { offset++; continue; }
    if (character === ',') {
      if (comma !== null || tokens.at(-1)?.value === undefined) throw new DrawingError('SFRENDER030', 'Unexpected path comma', offset);
      comma = offset++;
      continue;
    }
    if (/[a-z]/i.test(character)) {
      if (comma !== null) throw new DrawingError('SFRENDER030', 'A path comma must separate numeric arguments', comma);
      command = character.toUpperCase();
      argument = 0;
      tokens.push({command: character, offset});
      offset++;
    } else if (command === 'A' && (argument % 7 === 3 || argument % 7 === 4)) {
      if (character !== '0' && character !== '1') throw new DrawingError('SFRENDER037', 'Arc flag must be 0 or 1', offset);
      tokens.push({value: Number(character), offset});
      comma = null;
      offset++;
      argument++;
    } else {
      numberPattern.lastIndex = offset;
      const match = numberPattern.exec(source);
      if (!match) throw new DrawingError('SFRENDER030', 'Invalid path token', offset);
      const value = Number(match[0]);
      try { finite(value, 'path coordinate'); }
      catch (error) { throw new DrawingError('SFRENDER030', error.message, offset); }
      tokens.push({value, offset});
      comma = null;
      offset = numberPattern.lastIndex;
      argument++;
    }
    if (tokens.length > limit) throw new DrawingError('SFRENDER031', 'Path token budget exceeded', offset);
  }
  if (comma !== null) throw new DrawingError('SFRENDER030', 'Trailing path comma', comma);
  return tokens;
}

/** Parse commands into absolute figures; preserves elliptical arcs rather than approximating on input. */
export function parsePath(source, {maxCharacters = 8000000, maxSegments = 100000} = {}) {
  if (typeof source !== 'string' || !Number.isSafeInteger(maxCharacters) || maxCharacters < 0
    || !Number.isSafeInteger(maxSegments) || maxSegments < 0 || source.length > maxCharacters) throw new DrawingError('SFRENDER031', 'Invalid path input size');
  const tokens = tokenize(source, maxSegments * 8 + 8), figures = [];
  let index = 0, current = [0, 0], figure = null, command = null, previous = '', control = null, count = 0;
  let fillRule = 'evenodd';
  if (tokens[0]?.command?.toUpperCase() === 'F') {
    if (![0, 1].includes(tokens[1]?.value)) throw new DrawingError('SFRENDER032', 'Fill rule must be F0 or F1', tokens[0].offset);
    fillRule = tokens[1].value ? 'nonzero' : 'evenodd';
    index = 2;
  }
  while (index < tokens.length) {
    if (tokens[index].command) command = tokens[index++].command;
    if (!command) throw new DrawingError('SFRENDER033', 'Expected a path command', tokens[index].offset);
    const upper = command.toUpperCase(), relative = command !== upper;
    if (upper === 'Z') {
      if (!figure) throw new DrawingError('SFRENDER034', 'Close requires an open figure', tokens[index - 1].offset);
      figure.closed = true;
      current = [...figure.start];
      previous = 'Z'; control = null; command = null;
      continue;
    }
    const argumentsCount = argumentCounts[upper];
    if (!argumentsCount) throw new DrawingError('SFRENDER033', `Unknown path command ${command}`, tokens[index - 1]?.offset);
    const args = tokens.slice(index, index + argumentsCount);
    if (args.length !== argumentsCount || args.some(token => token.command)) {
      throw new DrawingError('SFRENDER035', `${command} needs ${argumentsCount} coordinates`, tokens[index]?.offset ?? source.length);
    }
    index += argumentsCount;
    const values = args.map(token => token.value);
    const point = at => [values[at] + (relative ? current[0] : 0), values[at + 1] + (relative ? current[1] : 0)];
    if (upper === 'M') {
      current = point(0);
      figure = {start: current, segments: [], closed: false, filled: true};
      figures.push(figure);
      command = relative ? 'l' : 'L'; previous = 'M'; control = null;
      continue;
    }
    if (!figure) throw new DrawingError('SFRENDER036', 'A path must begin with Move', args[0].offset);
    const reflected = control && (previous === 'C' || previous === 'S' || previous === 'Q' || previous === 'T') ?
      [current[0] * 2 - control[0], current[1] * 2 - control[1]] : current;
    let segment;
    if (upper === 'L') segment = {kind: 'line', end: point(0)};
    else if (upper === 'H') segment = {kind: 'line', end: [values[0] + (relative ? current[0] : 0), current[1]]};
    else if (upper === 'V') segment = {kind: 'line', end: [current[0], values[0] + (relative ? current[1] : 0)]};
    else if (upper === 'C') segment = {kind: 'cubic', control1: point(0), control2: point(2), end: point(4)};
    else if (upper === 'S') segment = {kind: 'cubic', control1: ['C', 'S'].includes(previous) ? reflected : current,
      control2: point(0), end: point(2)};
    else if (upper === 'Q') segment = {kind: 'quadratic', control: point(0), end: point(2)};
    else if (upper === 'T') segment = {kind: 'quadratic', control: ['Q', 'T'].includes(previous) ? reflected : current, end: point(0)};
    else {
      if (values[0] < 0 || values[1] < 0 || ![0, 1].includes(values[3]) || ![0, 1].includes(values[4])) {
        throw new DrawingError('SFRENDER037', 'Arc radii must be nonnegative and flags must be 0 or 1', args[0].offset);
      }
      segment = {kind: 'arc', radius: [values[0], values[1]], rotation: values[2], large: !!values[3], clockwise: !!values[4], end: point(5)};
    }
    figure.segments.push(segment);
    current = segment.end;
    control = segment.control2 ?? segment.control ?? null;
    previous = upper;
    if (++count > maxSegments) throw new DrawingError('SFRENDER031', 'Path segment budget exceeded', args[0].offset);
  }
  return {kind: 'path', fillRule, figures};
}

export const parsePathMarkup = parsePath;

/** Lossless canonical path serialization, suitable for SVG and deterministic fixture snapshots. */
export function pathToSvg(geometry) {
  const result = [];
  for (const figure of geometry.figures ?? []) {
    result.push(`M${figure.start.join(' ')}`);
    for (const segment of figure.segments) {
      if (segment.kind === 'line') result.push(`L${segment.end.join(' ')}`);
      else if (segment.kind === 'quadratic') result.push(`Q${segment.control.join(' ')} ${segment.end.join(' ')}`);
      else if (segment.kind === 'cubic') result.push(`C${segment.control1.join(' ')} ${segment.control2.join(' ')} ${segment.end.join(' ')}`);
      else if (segment.kind === 'arc') result.push(`A${segment.radius.join(' ')} ${segment.rotation} ${+segment.large} ${+segment.clockwise} ${segment.end.join(' ')}`);
    }
    if (figure.closed) result.push('Z');
  }
  return result.join(' ');
}
