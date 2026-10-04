import {unicodeCategory} from '../../src/text/unicode-properties.js';
import { LineBreak, names, values } from "./LineBreak.js";

const {
  AI, AL, CJ, CM, NS, SA, SG, SP, XX,
} = names;

export const sot = -1;
export const eot = -2;

/**
 * Convert a class number to a string, if possible.
 *
 * @param {number?} cls
 */
function classText(cls) {
  switch (cls) {
    case null:
      return null;
    case sot:
      return "sot";
    case eot:
      return "eot";
    default:
      return values[cls];
  }
}

/**
 * LB1: Assign a line breaking class to each code point of the input. Resolve
 * AI, CB, CJ, SA, SG, and XX into other line breaking classes depending on
 * criteria outside the scope of this algorithm.
 *
 * @param {number} cls
 * @param {string} char
 * @returns {number}
 */
export function resolve(cls, char) {
  switch (cls) {
    case AI:
    case SG:
    case XX:
      return AL;
    case SA:
      return ['Mn', 'Mc'].includes(unicodeCategory(char.codePointAt(0))) ? CM : AL;
    case CJ:
      return NS;
    default:
      // No changes needed
  }
  return cls;
}

/**
 * Information about a particular input character.
 */
export class BreakerChar {
  /**
   * Code point
   */
  cp = -Infinity;
  /**
   * Line breaking class, or `sot` or `eot`.
   */
  cls = sot;
  /**
   * The character.  Might be one or two UTF-16 JS characters.
   */
  char = "";
  /**
   * The length of the whole string up to and including char, in JS chars.
   */
  len = 0;

  /**
   * If true, this is an LB9 CM or ZWJ that is treated as coalesced into
   * the previous code point.
   */
  ignored = false;

  /**
   * @param {number} cls
   * @param {number} cp
   * @param {string} char
   * @param {number} len
   */
  constructor(cls, cp, char, len) {
    this.cls = cls;
    this.cp = cp;
    this.char = char;
    this.len = len;
  }

  /**
   * Debug helper.
   *
   * @param {number} _depth
   * @param {import('util').InspectOptionsStylized} _inspectOptions
   * @param {(x: any) => string} _inspect
   * @returns
   */
  [Symbol.for("nodejs.util.inspect.custom")](_depth, _inspectOptions, _inspect) {
    return `${classText(this.cls)}(${this.cp.toString(16).padStart(4, "0")}:${JSON.stringify(this.char)})${this.ignored ? "Ig" : ""}`;
  }
}

/**
 * @private
 */
export class BreakerState {
  str = "";
  len = 0;
  prevChunk = 0;

  prev = new BreakerChar(sot, -Infinity, "", 0);
  cur = new BreakerChar(sot, -Infinity, "", 0);
  next = new BreakerChar(sot, -Infinity, "", 0);

  // Parsing state
  LB8 = false;
  spaces = false;
  RI = 0;

  /**
   * Extra properties, to be copied to Break when created.
   *
   * @type {Record<string,any>=}
   */
  props = undefined;

  /**
   * Extra state information, for use by tailoring subclasses.
   *
   * @type {Record<string,any>}
   */
  extra = {};

  /**
   * @param {string} str
   */
  constructor(str, work) {
    this.work = work;
    this.str = str;
    this.len = str.length;
  }

  /**
   * Move to the next state.
   *
   * @param {BreakerChar} step
   */
  push(step) {
    if (this.next.ignored) {
      this.cur.len = this.next.len;
    } else {
      this.prev = this.cur;
      this.cur = this.next;
    }
    this.next = step;
  }

  pushEnd() {
    this.push(new BreakerChar(eot, Infinity, "", this.next.len));
  }

  /**
   * Iterate over the codepoints in the string, starting at pos.
   *
   * @param {number} pos;
   * @param {boolean} [fwd=true] If true, go forward.  Otherwise reverse.
   */
  * codePoints(pos, fwd = true) {
    if (fwd) {
      while (pos < this.len) {
        this.work?.();
        if ((pos === this.cur.len) && (this.next.cls >= 0)) { // Not sot or eot
          // Re-use this.next, so that LB9 changes stay in effect.
          // Might be worth caching more of these.
          yield this.next;
          pos += this.next.char.length;
        } else {
          const cp = /** @type {number} */ (this.str.codePointAt(pos));
          const char = String.fromCodePoint(cp);
          const cls = LineBreak.get(cp);
          pos += char.length; // 1 or 2.
          yield new BreakerChar(resolve(cls, char), cp, char, pos);
        }
      }
    } else {
      while (pos > 0) {
        this.work?.();
        if (pos === this.cur.len) {
          yield this.cur;
          pos -= this.cur.char.length;
        } else if (pos === this.prev.len) {
          yield this.prev;
          pos -= this.prev.char.length;
        } else {
          let prev = pos - 1;
          // Intentional use of charCodeAt.
          const prevUSV = this.str.charCodeAt(prev);
          if ((prevUSV >= 0xdc00) && (prevUSV <= 0xdfff)) {
            // High surrogate, go back one more.
            prev--;
          }
          const cp = /** @type {number} */ (this.str.codePointAt(prev));
          const char = String.fromCodePoint(cp);
          const cls = LineBreak.get(cp);
          yield new BreakerChar(resolve(cls, char), cp, char, pos);
          pos = prev;
        }
      }
    }
  }

  /**
   * Look ahead in the string to see what the next linebreak class is after zero
   * or more spaces, starting at JS char offset pos.
   *
   * @param {number} pos
   * @returns {number}
   */
  classAfterSpaces(pos) {
    for (const { cls } of this.codePoints(pos)) {
      if (cls !== SP) {
        return cls;
      }
    }
    return eot;
  }

  /**
   * Get the character after next.
   *
   * @returns {BreakerChar?}
   */
  afterNext(offset = 1) {
    for (const chr of this.codePoints(this.next.len)) {
      if (--offset <= 0) {
        return chr;
      }
    }
    return null;
  }

  /**
   * Set some extra information in the state that will be passed to
   * the next created Break.
   *
   * @param {string} key
   * @param {any} value
   */
  setProp(key, value) {
    if (!this.props) {
      this.props = {};
    }
    this.props[key] = value;
  }

  /**
   * Debug helper.
   *
   * @param {number} _depth
   * @param {import('util').InspectOptionsStylized} _inspectOptions
   * @param {(x: any) => string} inspect
   * @returns
   */
  [Symbol.for("nodejs.util.inspect.custom")](_depth, _inspectOptions, inspect) {
    let pn = `${inspect(this.prev)} => ${inspect(this.cur)} => ${inspect(this.next)}`;

    if (this.LB8) {
      pn += " LB8";
    }
    if (this.spaces) {
      pn += " spaces";
    }
    if (this.RI > 0) {
      pn += ` RI: ${this.RI}`;
    }

    if (this.props) {
      pn += ` ${JSON.stringify(this.props)}`;
    }

    return pn;
  }
}
