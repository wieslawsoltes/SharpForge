import {DrawingError} from '../drawing/commands.js';
import {ranges as scriptRanges, names as scriptNames} from '../../vendor/unicode/scripts.js';
import {ranges as graphemeRanges, names as graphemeNames} from '../../vendor/unicode/graphemes.js';
import {ranges as conjunctRanges, names as conjunctNames} from '../../vendor/unicode/indic-conjunct.js';
import {ranges as pictographicRanges} from '../../vendor/unicode/extended-pictographic.js';
import {ranges as presentationRanges} from '../../vendor/unicode/emoji-presentation.js';
import {ranges as ignorableRanges} from '../../vendor/unicode/default-ignorable.js';
import {unicodeProperty} from './unicode-properties.js';

export function unicodeCharacter(text, index) {
  const codePoint = text.codePointAt(index);
  return {codePoint, index, end: index + (codePoint > 0xffff ? 2 : 1),
    script: scriptNames[unicodeProperty(scriptRanges, codePoint)],
    grapheme: graphemeNames[unicodeProperty(graphemeRanges, codePoint)],
    conjunct: conjunctNames[unicodeProperty(conjunctRanges, codePoint)],
    pictographic: Boolean(unicodeProperty(pictographicRanges, codePoint)),
    emoji: Boolean(unicodeProperty(presentationRanges, codePoint)),
    ignorable: Boolean(unicodeProperty(ignorableRanges, codePoint))};
}

function isControl(character) {
  return character.grapheme === 'Control' || character.grapheme === 'CR' || character.grapheme === 'LF';
}

function joins(previous, current, state) {
  const before = previous.grapheme;
  const after = current.grapheme;
  if (before === 'CR' && after === 'LF') return true;
  if (isControl(previous) || isControl(current)) return false;
  if (before === 'L' && ['L', 'V', 'LV', 'LVT'].includes(after)) return true;
  if (['LV', 'V'].includes(before) && ['V', 'T'].includes(after)) return true;
  if (['LVT', 'T'].includes(before) && after === 'T') return true;
  if (after === 'Extend' || after === 'ZWJ' || after === 'SpacingMark' || before === 'Prepend') return true;
  if (current.conjunct === 'Consonant' && state.conjunct === 2) return true;
  if (current.pictographic && before === 'ZWJ' && state.emojiJoiner) return true;
  return before === 'Regional_Indicator' && after === 'Regional_Indicator' && state.regional % 2 === 1;
}

function advanceState(state, current) {
  state.regional = current.grapheme === 'Regional_Indicator' ? state.regional + 1 : 0;
  state.emojiJoiner = current.grapheme === 'ZWJ' && state.pictographic;
  if (current.pictographic) state.pictographic = true;
  else if (current.grapheme !== 'Extend') state.pictographic = false;
  if (current.conjunct === 'Consonant') state.conjunct = 1;
  else if (current.conjunct === 'Linker' && state.conjunct) state.conjunct = 2;
  else if (current.conjunct !== 'Extend') state.conjunct = 0;
}

/** Unicode17 UAX29 extended graphemes, including Indic conjuncts and emoji ZWJ sequences.
 * Offsets are UTF-16; segmentation is linear and never splits a surrogate pair.
 */
export function segmentGraphemes(text, {maxClusters = 100000, signal} = {}) {
  const result = [];
  const state = {regional: 0, pictographic: false, emojiJoiner: false, conjunct: 0};
  let previous = null;
  let cluster = null;
  for (let index = 0; index < text.length;) {
    if ((index & 1023) === 0) signal?.throwIfAborted();
    const character = unicodeCharacter(text, index);
    if (!previous || !joins(previous, character, state)) {
      if (result.length >= maxClusters) throw new DrawingError('SFRENDER082', 'Text cluster budget exceeded');
      cluster = {start: index, end: character.end, characters: [], script: 'Zyyy', emoji: false};
      result.push(cluster);
      state.pictographic = false;
      state.emojiJoiner = false;
      state.conjunct = 0;
    }
    cluster.characters.push(character);
    cluster.end = character.end;
    if (!['Zyyy', 'Zinh', 'Zzzz'].includes(character.script)) cluster.script = character.script;
    cluster.emoji ||= character.emoji || character.codePoint === 0xfe0f;
    advanceState(state, character);
    previous = character;
    index = character.end;
  }
  resolveCommonScripts(result);
  return result;
}

function resolveCommonScripts(clusters) {
  let previous = null;
  for (const cluster of clusters) {
    if (cluster.characters.some(character => ['CR', 'LF', 'Control'].includes(character.grapheme))) previous = null;
    else if (cluster.script !== 'Zyyy') previous = cluster.script;
    else if (previous) cluster.script = previous;
  }
  let following = 'Zyyy';
  for (let index = clusters.length - 1; index >= 0; index--) {
    const cluster = clusters[index];
    if (cluster.characters.some(character => ['CR', 'LF', 'Control'].includes(character.grapheme))) following = 'Zyyy';
    else if (cluster.script !== 'Zyyy') following = cluster.script;
    else cluster.script = following;
  }
}

export const unicodeTextVersions = Object.freeze({graphemes: '17.0.0', scripts: '17.0.0', lineBreak: '17.0.0', bidi: '13.0.0'});
