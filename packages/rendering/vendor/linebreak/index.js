import {unicodeCategory, unicodeExtendedPictographic} from '../../src/text/unicode-properties.js';
import { BreakerState, eot, sot } from "./state.js";
import { LineBreak, names as LineBreakClasses } from "./LineBreak.js";
import { Break } from "./break.js";
import { EastAsianWidth } from "./EastAsianWidth.js";

export {
  Break,
  BreakerState,
  EastAsianWidth,
  LineBreak,
  LineBreakClasses,
  eot,
  sot,
};

const {
  AK, AL, AP, AS, B2, BA, BB, BK, CB, CL, CM, CP, CR, EB, EM, EX, GL,
  H2, H3, HH, HL, HY, ID, IN, IS, JL, JT, JV, LF, NU, OP, NL, NS, PO,
  PR, RI, SP, SY, QU, VF, VI, WJ, ZW, ZWJ,
} = LineBreakClasses;

const ALHLNU = new Set([AL, HL, NU]);
const BKCRLFNLSPZW = new Set([BK, CR, LF, NL, SP, ZW]);
const IDEBEM = new Set([ID, EB, EM]);
const JLJVH2H3 = new Set([JL, JV, H2, H3]);
const JLJVJTH2H3 = new Set([JL, JV, JT, H2, H3]);
const JVJT = new Set([JV, JT]);
const SPGLWJCLQUCPEXISSYBKCRLFNLZW
  = new Set([SP, GL, WJ, CL, QU, CP, EX, IS, SY, BK, CR, LF, NL, ZW]);
const sotBKCRLFNLOPQUGLSPZW
  = new Set([sot, BK, CR, LF, NL, OP, QU, GL, SP, ZW]);

// See: https://oida.dev/symbols-in-javascript-and-typescript/

/**
 * @template T
 * @typedef {ValuesWithKeys<T, keyof T>} EnumValues
 */

/**
 * @template T
 * @template {keyof T} K
 * @typedef {T[K]} ValuesWithKeys
 */

// Possible results from a rule:

/**
 * This rule has no opinion.
 */
export const PASS = Symbol("PASS");

/**
 * This rule asserts that there must not be a break after the current
 * code point.
 */
export const NO_BREAK = Symbol("NO_BREAK");

/**
 * This rule asserts that there may be a break after the current code point.
 */
export const MAY_BREAK = Symbol("MAY_BREAK");

/**
 * This rule asserts that there must be a line break after the current code point.
 */
export const MUST_BREAK = Symbol("MUST_BREAK");

export const RuleResults = /** @type {const} */({
  PASS,
  NO_BREAK,
  MAY_BREAK,
  MUST_BREAK,
});

/**
 * @typedef {EnumValues<typeof RuleResults>} RuleResultsEnum
 */

/**
 * A rule that impacts linebreaking.  Looking ahead and behind one code point
 * is fast, using `state.prev` and `state.next` respectively.  Looking ahead
 * more code points is possible with `*BreakerState.codePoints()`, but be
 * careful of causing ReDos vulnerabilities.
 *
 * @callback BreakRule
 * @param {BreakerState} state
 * @returns {RuleResultsEnum}
 */

/**
 * LB2: Never break at the start of text.
 *
 * @type {BreakRule}
 */
export function LB02(state) {
  /// sot ×
  if ((state.cur.cls === sot) && (state.next.cls !== eot)) {
    return NO_BREAK;
  }
  return PASS;
}

/**
 * LB3 Always break at the end of text.
 *
 * @type {BreakRule}
 */
export function LB03(state) {
  if ((state.next.cls === eot)
      && ((state.cur.len === 0) || (state.cur.len !== state.prevChunk))) {
    return MUST_BREAK;
  }
  return PASS;
}

/**
 * LB4: Always break after hard line breaks.
 *
 * @type {BreakRule}
 */
export function LB04(state) {
  // BK !
  if (state.cur.cls === BK) {
    return MUST_BREAK;
  }
  return PASS;
}

/**
 * LB5: Treat CR followed by LF, as well as CR, LF, and NL as hard line
 * breaks.
 *
 * @type {BreakRule}
 */
export function LB05(state) {
  switch (state.cur.cls) {
    case CR:
      if (state.next.cls === LF) {
        return NO_BREAK; // CR × LF
      }
      return MUST_BREAK; // CR !

    case LF: // LF !
    case NL: // NL !
      return MUST_BREAK;
    default:
  }
  return PASS;
}

/**
 * LB6: Do not break before hard line breaks.
 *
 * @type {BreakRule}
 */
export function LB06(state) {
  // × ( BK | CR | LF | NL )
  switch (state.next.cls) {
    case BK:
    case CR:
    case LF:
    case NL:
      return NO_BREAK;
    default:
  }
  return PASS;
}

/**
 * The end of a run of spaces, for rules that have "Do not break within
 * ...even with intervening spaces", such as LB15.
 *
 * @type {BreakRule}
 */
export function LBspacesStop(state) {
  if (state.cur.cls !== RI) {
    state.RI = 0;
  }
  if (state.spaces) {
    if (state.next.cls !== SP) {
      state.spaces = false;
    }
    return NO_BREAK;
  }
  return PASS;
}

/**
 * LB7: Do not break before spaces or zero width space.
 *
 * @type {BreakRule}
 */
export function LB07(state) {
  // × ZW
  if (state.next.cls === ZW) {
    return NO_BREAK;
  }

  // × SP
  if (state.next.cls === SP) {
    switch (state.cur.cls) {
      case ZW: // See LB8
      case OP: // See LB14
      case QU: // See LB15
      case CL: // See LB16
      case CP: // See LB16
      case B2: // See LB17
        break;
      default:
        return NO_BREAK;
    }
  }
  return PASS;
}

/**
 * LB8: Break before any character following a zero-width space, even if one or
 * more spaces intervene.
 *
 * @type {BreakRule}
 */
export function LB08(state) {
  // LB8 is special, because it breaks after the run of spaces, unlike
  // the .spaces cases, which NO_BREAK after the rub of spaces.

  // ZW SP* ÷
  if (state.LB8) {
    // Assume state.next.cls !== SP, because LB7
    state.LB8 = false;
    return MAY_BREAK;
  } else if (state.cur.cls === ZW) {
    if (state.next.cls === SP) {
      state.LB8 = true;
      return NO_BREAK;
    }
    return MAY_BREAK;
  }
  return PASS;
}

/**
 * LB8a: Do not break after a zero width joiner.
 *
 * @type {BreakRule}
 */
export function LB08a(state) {
  // ZWJ ×
  if (state.cur.cls === ZWJ) {
    return NO_BREAK;
  }
  return PASS;
}

/**
 * LB9: Do not break a combining character sequence; treat it as if it has the
 * line breaking class of the base character in all of the following rules.
 * Treat ZWJ as if it were CM.
 *
 * @type {BreakRule}
 */
export function LB09(state) {
  // Treat X (CM | ZWJ)* as if it were X.
  // where X is any line break class except BK, CR, LF, NL, SP, or ZW.
  if (!BKCRLFNLSPZW.has(state.cur.cls)
      && ((state.next.cls === CM) || (state.next.cls === ZWJ))) {
    state.next.ignored = true;
    return NO_BREAK;
  }
  return PASS;
}

/**
 * LB10: Treat any remaining combining mark or ZWJ as AL.
 *
 * @type {BreakRule}
 */
export function LB10(state) {
  if (state.cur.cls === CM) {
    state.cur.cls = AL;

    //
    // // @ts-ignore
    // if (this.opts.verbose) {
    //   console.log(state.cur.len, state, 'LB10');
    // }
  }
  if (state.next.cls === CM) {
    state.next.cls = AL;

    //
    // // @ts-ignore
    // if (this.opts.verbose) {
    //   console.log(state.cur.len, state, 'LB10');
    // }
  }
  return PASS;
}

/**
 * LB11: Do not break before or after Word joiner and related characters.
 *
 * @type {BreakRule}
 */
export function LB11(state) {
  if (
    (state.next.cls === WJ) // × WJ
    || (state.cur.cls === WJ) // WJ ×
  ) {
    return NO_BREAK;
  }
  return PASS;
}

/**
 * LB12: Do not break after NBSP and related characters.
 *
 * @type {BreakRule}
 */
export function LB12(state) {
  // GL ×
  if (state.cur.cls === GL) {
    return NO_BREAK;
  }
  return PASS;
}

/**
 * LB12a: Do not break before NBSP and related characters, except after spaces
 * and hyphens.
 *
 * @type {BreakRule}
 */
export function LB12a(state) {
  // [^SP BA HY HH] × GL
  if (state.next.cls === GL) {
    switch (state.cur.cls) {
      case SP:
      case BA:
      case HY:
      case HH:
        return PASS;
      default:
        return NO_BREAK;
    }
  }
  return PASS;
}

/**
 * LB13: Do not break before ‘]’ or ‘!’ or ‘;’ or ‘/’, even after spaces.
 *
 * @type {BreakRule}
 */
export function LB13(state) {
  // × CL (e.g.)
  switch (state.next.cls) {
    case CL:
    case CP:
    case EX:
    case SY:
      return NO_BREAK;
    default:
  }
  return PASS;
}

/**
 * LB14: Do not break after ‘[’, even after spaces.
 *
 * @type {BreakRule}
 */
export function LB14(state) {
  // OP SP* ×
  if (state.cur.cls === OP) {
    if (state.next.cls === SP) {
      state.spaces = true;
    }
    return NO_BREAK;
  }
  return PASS;
}

/**
 * LB15a: Do not break after an unresolved initial punctuation that lies at
 * the start of the line, after a space, after opening punctuation, or after
 * an unresolved quotation mark, even after spaces.
 *
 * @type {BreakRule}
 */
export function LB15a(state) {
  // (sot | BK | CR | LF | NL | OP | QU | GL | SP | ZW) [\p{Pi}&QU] SP* ×
  if (sotBKCRLFNLOPQUGLSPZW.has(state.prev.cls)
      && (unicodeCategory(state.cur.char.codePointAt(0)) === 'Pi')
      && (state.cur.cls === QU)) {
    state.spaces = true;
    return NO_BREAK;
  }
  return PASS;
}

/**
 * LB15b: Do not break before an unresolved final punctuation that lies at the
 * end of the line, before a space, before a prohibited break, or before an
 * unresolved quotation mark, even after spaces.
 *
 * @type {BreakRule}
 */
export function LB15b(state) {
  // × [\p{Pf}&QU] ( SP | GL | WJ | CL | QU | CP | EX | IS | SY | BK | CR | LF | NL | ZW | eot)
  if ((unicodeCategory(state.next.char.codePointAt(0)) === 'Pf') && (state.next.cls === QU)) {
    const after = state.afterNext();
    if (!after) { // Only on eot
      return NO_BREAK;
    }

    if (SPGLWJCLQUCPEXISSYBKCRLFNLZW.has(after.cls)) {
      return NO_BREAK;
    }
  }
  return PASS;
}

/**
 * LB15c: Break before a decimal mark that follows a space, for instance, in
 * ‘subtract .5’.
 *
 * @type {BreakRule}
 */
export function LB15c(state) {
  // SP ÷ IS NU
  if ((state.cur.cls === SP) && (state.next.cls === IS)) {
    const after = state.afterNext();
    if (after?.cls === NU) {
      return MAY_BREAK;
    }
  }
  return PASS;
}

/**
 * LB15d: Otherwise, do not break before ‘;’, ‘,’, or ‘.’, even after spaces
 *
 * @type {BreakRule}
 */
export function LB15d(state) {
  // × IS
  if (state.next.cls === IS) {
    return NO_BREAK;
  }
  return PASS;
}

/**
 * LB16: Do not break between closing punctuation and a nonstarter (lb=NS),
 * even with intervening spaces.
 *
 * @type {BreakRule}
 */
export function LB16(state) {
  // (CL | CP) SP* × NS
  if ((state.cur.cls === CL) || (state.cur.cls === CP)) {
    if (state.classAfterSpaces(state.cur.len) === NS) {
      if (state.next.cls === SP) {
        state.spaces = true;
      }
      return NO_BREAK;
    }
    if (state.next.cls === SP) {
      return NO_BREAK; // LB7
    }
  }
  return PASS;
}

/**
 * LB17: Do not break within ‘——’, even with intervening spaces.
 *
 * @type {BreakRule}
 */
export function LB17(state) {
  // B2 SP* × B2
  if (state.cur.cls === B2) {
    if (state.classAfterSpaces(state.cur.len) === B2) {
      if (state.next.cls !== SP) {
        return NO_BREAK; // LB7
      }

      state.spaces = true;
      return NO_BREAK;
    } else if (state.next.cls === SP) {
      return NO_BREAK; // LB7
    }
  }
  return PASS;
}

/**
 * LB18: Break after spaces.
 *
 * @type {BreakRule}
 */
export function LB18(state) {
  // SP ÷
  if (state.cur.cls === SP) {
    return MAY_BREAK;
  }
  return PASS;
}

/**
 * LB19: Do not break before non-initial unresolved quotation marks, such as ‘
 * ” ’ or ‘ " ’, nor after non-final unresolved quotation marks, such as ‘ “ ’
 * or ‘ " ’.
 *
 * @type {BreakRule}
 */
export function LB19(state) {
  // × [ QU - \p{Pi} ]
  if ((state.next.cls === QU) && !(unicodeCategory(state.next.char.codePointAt(0)) === 'Pi')) {
    // Gc=Pi is initial puctuation
    return NO_BREAK;
  }

  // [ QU - \p{Pf} ] ×
  if ((state.cur.cls === QU) && !(unicodeCategory(state.cur.char.codePointAt(0)) === 'Pf')) {
    // Gc=Pf is final puctuation
    return NO_BREAK;
  }

  return PASS;
}

/**
 * LB19a: Unless surrounded by East Asian characters, do not break either side
 * of any unresolved quotation marks.
 *
 * @type {BreakRule}
 */
export function LB19a(state) {
  // [^$EastAsian] × QU
  if (!EastAsianWidth.get(state.cur.cp) && (state.next.cls === QU)) {
    return NO_BREAK;
  }
  // × QU ( [^$EastAsian] | eot )
  if (state.next.cls === QU) {
    const after = state.afterNext();
    if (!after || !EastAsianWidth.get(after.cp)) {
      return NO_BREAK;
    }
  }

  // QU × [^$EastAsian]
  if ((state.cur.cls === QU) && !EastAsianWidth.get(state.next.cp)) {
    return NO_BREAK;
  }

  // ( sot | [^$EastAsian] ) QU ×
  if (((state.prev.cls === sot) || !EastAsianWidth.get(state.prev.cp))
      && (state.cur.cls === QU)) {
    return NO_BREAK;
  }
  return PASS;
}

/**
 * LB20: Break before and after unresolved CB.
 *
 * @type {BreakRule}
 */
export function LB20(state) {
  // ÷ CB
  // CB ÷
  if ((state.cur.cls === CB) || (state.next.cls === CB)) {
    return MAY_BREAK;
  }
  return PASS;
}

const sotBKCRLFNLSPZWCBGL = new Set([sot, BK, CR, LF, NL, SP, ZW, CB, GL]);

/**
 * LB20a: Do not break after a word-initial hyphen.
 *
 * @type {BreakRule}
 */
export function LB20a(state) {
  // ( sot | BK | CR | LF | NL | SP | ZW | CB | GL ) ( HY | HH ) × ( AL | HL )
  if (sotBKCRLFNLSPZWCBGL.has(state.prev.cls)
      && ((state.cur.cls === HY) || (state.cur.cls === HH))
      && ((state.next.cls === AL) || (state.next.cls === HL))) {
    return NO_BREAK;
  }
  return PASS;
}

/**
 * LB21: Do not break before hyphen-minus, other hyphens, fixed-width spaces,
 * small kana, and other non-starters, or after acute accents.
 *
 * @type {BreakRule}
 */
export function LB21(state) {
  // BB ×
  if (state.cur.cls === BB) {
    return NO_BREAK;
  }

  // × (BA | HH | HY | NS)
  switch (state.next.cls) {
    case BA:
    case HH:
    case HY:
    case NS:
      return NO_BREAK;
    default:
  }
  return PASS;
}

/**
 * LB21a: Do not break after the hyphen in Hebrew + Hyphen + non-Hebrew.
 *
 * @type {BreakRule}
 */
export function LB21a(state) {
  // HL (HY | HH) × [^HL]
  if ((state.prev.cls === HL)
      && ((state.cur.cls === HY) || (state.cur.cls === HH))
      && (state.next.cls !== HL)) {
    return NO_BREAK;
  }
  return PASS;
}

/**
 * LB21b: Don’t break between Solidus and Hebrew letters.
 *
 * @type {BreakRule}
 */
export function LB21b(state) {
  // SY × HL
  if ((state.cur.cls === SY) && (state.next.cls === HL)) {
    return NO_BREAK;
  }
  return PASS;
}

/**
 * LB22: Do not break before ellipses.
 *
 * @type {BreakRule}
 */
export function LB22(state) {
  // × IN
  if (state.next.cls === IN) {
    return NO_BREAK;
  }
  return PASS;
}

/**
 * LB23: Do not break between digits and letters.
 *
 * @type {BreakRule}
 */
export function LB23(state) {
  switch (state.cur.cls) {
    case AL:
    case HL:
      // (AL | HL) × NU
      if (state.next.cls === NU) {
        return NO_BREAK;
      }
      break;
    case NU:
      // NU × (AL | HL)
      if ((state.next.cls === AL) || (state.next.cls === HL)) {
        return NO_BREAK;
      }
      break;
    default:
  }
  return PASS;
}

/**
 * LB23a: Do not break between numeric prefixes and ideographs, or between
 * ideographs and numeric postfixes.
 *
 * @type {BreakRule}
 */
export function LB23a(state) {
  // PR × (ID | EB | EM)
  if ((state.cur.cls === PR) && IDEBEM.has(state.next.cls)) {
    return NO_BREAK;
  }
  // (ID | EB | EM) × PO
  if ((state.next.cls === PO) && IDEBEM.has(state.cur.cls)) {
    return NO_BREAK;
  }
  return PASS;
}

/**
 * LB24: Do not break between numeric prefix/postfix and letters, or between
 * letters and prefix/postfix.
 *
 * @type {BreakRule}
 */
export function LB24(state) {
  // (PR | PO) × (AL | HL)
  if (((state.cur.cls === PR) || (state.cur.cls === PO))
      && ((state.next.cls === AL) || (state.next.cls === HL))) {
    return NO_BREAK;
  }
  // (AL | HL) × (PR | PO)
  if (((state.cur.cls === AL) || (state.cur.cls === HL))
      && ((state.next.cls === PR) || (state.next.cls === PO))) {
    return NO_BREAK;
  }

  // Yeah, we're not doing this:
  // ( PR | PO) ? ( OP | HY ) ? IS ? NU (NU | SY | IS) * (CL | CP) ? ( PR | PO) ?
  return PASS;
}

// /**
//  * Continue to NO_BREAK as long as we are processing a LB25 regex.
//  *
//  * @type {BreakRule}
//  */
// export function LB25_Continue(state) {
//   if (state.ex7pos !== null) {
//     if (state.cur.len >= state.ex7pos) {
//       state.ex7pos = null;
//     } else {
//       return NO_BREAK;
//     }
//   }
//   return PASS;
// }

const POPR = new Set([PO, PR]);
const CLCP = new Set([CL, CP]);

/**
 * LB25: Do not break numbers.
 * Approach: Find the end of a matching run, then no-break everything as we go
 * past it.
 *
 * @type {BreakRule}
 */
export function LB25(state) {
  // NU ( SY | IS )* CL × PO
  // NU ( SY | IS )* CP × PO
  // NU ( SY | IS )* CL × PR
  // NU ( SY | IS )* CP × PR
  // NU ( SY | IS )* × PO
  // NU ( SY | IS )* × PR
  // NU ( SY | IS )* × NU
  let syIs = null;
  if (POPR.has(state.next.cls)) {
    if (CLCP.has(state.cur.cls)) {
      syIs = state.prev.len;
    } else {
      syIs = state.cur.len;
    }
  } else if (state.next.cls === NU) {
    syIs = state.cur.len;
  }

  // As specified, possible ReDoS because of the backtracking.  In practice,
  // I think it's probably ok.
  if (syIs !== null) {
    SyIsLoop:
    for (const { cls } of state.codePoints(syIs, false)) {
      switch (cls) {
        case SY:
        case IS:
          continue;
        case NU:
          return NO_BREAK;
        default:
          break SyIsLoop;
      }
    }
  }

  // PO × OP NU
  // PO × OP IS NU
  // PO × NU
  // PR × OP NU
  // PR × OP IS NU
  // PR × NU
  if ((state.cur.cls === PO) || ((state.cur.cls === PR))) {
    if (state.next.cls === OP) {
      const after = state.afterNext();
      if (after) {
        if (after.cls === NU) {
          return NO_BREAK;
        } else if (after.cls === IS) {
          const aafter = state.afterNext(2);
          if (aafter?.cls === NU) {
            return NO_BREAK;
          }
        }
      }
    } else if (state.next.cls === NU) {
      return NO_BREAK;
    }
  }

  // HY × NU
  if ((state.cur.cls === HY) && (state.next.cls === NU)) {
    return NO_BREAK;
  }

  // IS × NU
  if ((state.cur.cls === IS) && (state.next.cls === NU)) {
    return NO_BREAK;
  }

  return PASS;
}

/**
 * LB26: Do not break a Korean syllable.
 *
 * @type {BreakRule}
 */
export function LB26(state) {
  switch (state.cur.cls) {
    case JL:
      // JL × (JL | JV | H2 | H3)
      if (JLJVH2H3.has(state.next.cls)) {
        return NO_BREAK;
      }
      break;
    case JV:
    case H2:
      // (JV | H2) × (JV | JT)
      if (JVJT.has(state.next.cls)) {
        return NO_BREAK;
      }
      break;
    case JT:
    case H3:
      // (JT | H3) × JT
      if (state.next.cls === JT) {
        return NO_BREAK;
      }
      break;
    default:
  }
  return PASS;
}

/**
 * LB27: Treat a Korean Syllable Block the same as ID.
 *
 * @type {BreakRule}
 */
export function LB27(state) {
  switch (state.cur.cls) {
    case JL:
    case JV:
    case JT:
    case H2:
    case H3:
      // (JL | JV | JT | H2 | H3) × PO
      if (state.next.cls === PO) {
        return NO_BREAK;
      }
      break;
    case PR:
      // PR × (JL | JV | JT | H2 | H3)
      if (JLJVJTH2H3.has(state.next.cls)) {
        return NO_BREAK;
      }
      break;
    default:
  }
  return PASS;
}

/**
 * LB28 Do not break between alphabetics (“at”).
 *
 * @type {BreakRule}
 */
export function LB28(state) {
  // (AL | HL) × (AL | HL)
  if (((state.cur.cls === AL) || (state.cur.cls === HL))
    && ((state.next.cls === AL) || (state.next.cls === HL))) {
    return NO_BREAK;
  }
  return PASS;
}

/**
 * LB28a: Do not break inside the orthographic syllables of Brahmic scripts.
 *
 * @type {BreakRule}
 */
export function LB28a(state) {
  const { prev, cur, next } = state;
  const dotCircle = "\u25CC";

  /**
   * AK | ◌ | AS
   *
   * @param {import('./state.js').BreakerChar} chr Check one char
   * @returns true if char matches
   */
  function akCas(chr) {
    return (chr.cls === AK) || (chr.char === dotCircle) || (chr.cls === AS);
  }

  // AP × (AK | ◌ | AS)
  if ((cur.cls === AP) && akCas(next)) {
    return NO_BREAK;
  }

  // (AK | ◌ | AS) × (VF | VI)
  if (akCas(cur)
      && ((next.cls === VF) || (next.cls === VI))) {
    return NO_BREAK;
  }

  // (AK | ◌ | AS) VI × (AK | ◌)
  if (akCas(prev)
      && (cur.cls === VI)
      && ((next.cls === AK) || (next.char === dotCircle))) {
    return NO_BREAK;
  }

  // (AK | ◌ | AS) × (AK | ◌ | AS) VF
  if (akCas(cur)
      && akCas(next)
      && (state.afterNext()?.cls === VF)) {
    return NO_BREAK;
  }

  return PASS;
}

/**
 * LB29: Do not break between numeric punctuation and alphabetics (“e.g.”).
 *
 * @type {BreakRule}
 */
export function LB29(state) {
  // IS × (AL | HL)
  if ((state.cur.cls === IS)
    && ((state.next.cls === AL) || (state.next.cls === HL))) {
    return NO_BREAK;
  }
  return PASS;
}

/**
 * LB30: Do not break between letters, numbers, or ordinary symbols and
 * opening or closing parentheses.
 *
 * @type {BreakRule}
 */
export function LB30(state) {
  switch (state.cur.cls) {
    case AL:
    case HL:
    case NU:
      // (AL | HL | NU) × [OP-$EastAsian]
      if ((state.next.cls === OP) && !EastAsianWidth.get(state.next.cp)) {
        return NO_BREAK;
      }
      break;
    case CP:
      // [CP-$EastAsian] × (AL | HL | NU)
      if (!EastAsianWidth.get(state.cur.cp) && ALHLNU.has(state.next.cls)) {
        return NO_BREAK;
      }
      break;
    default:
  }

  return PASS;
}

/**
 * LB30a: Break between two regional indicator symbols if and only if there
 * are an even number of regional indicators preceding the position of the
 * break.
 *
 * @type {BreakRule}
 */
export function LB30a(state) {
  if (state.cur.cls === RI) {
    if (state.next.cls === RI) {
      if (++state.RI % 2 !== 0) {
        return NO_BREAK;
      }
    }
  } else {
    state.RI = 0;
  }
  return PASS;
}

/**
 * LB30b: Do not break between an emoji base (or potential emoji) and an emoji
 * modifier.
 *
 * @type {BreakRule}
 */
export function LB30b(state) {
  // EB × EM
  if ((state.cur.cls === EB) && (state.next.cls === EM)) {
    return NO_BREAK;
  }

  // [\p{Extended_Pictographic}&\p{Cn}] × EM
  // I *think* this was supposed to be:
  // [\p{Extended_Pictographic}&&\p{Cn}] × EM
  //
  // The Extended_Pictographic property is used to customize segmentation (as
  // described in [UAX29] and [UAX14]) so that possible future emoji ZWJ
  // sequences will not break grapheme clusters, words, or lines. Unassigned
  // codepoints with Line_Break=ID in some blocks are also assigned the
  // Extended_Pictographic property. Those blocks are intended for future
  // allocation of emoji characters.
  if ((state.next.cls === EM)
    && (unicodeExtendedPictographic(state.cur.cp))
    && ((unicodeCategory(state.cur.char.codePointAt(0)) === 'Cn'))) {
    return NO_BREAK;
  }

  return PASS;
}

/**
 * LB31: Break everywhere else.
 *
 * @type {BreakRule}
 */
export function LB31() {
  return MAY_BREAK;
}

/**
 * @type {BreakRule[]}
 * @private
 */
const rules = [
  // LB1, handled in *BreakerState.codePoints(), so that look-aheads are
  // resolved.
  LB02,
  LB03,
  LB04,
  LB05,
  LB06,
  // LB25_Continue,
  LBspacesStop, // Must be before LB7.
  LB07,
  LB08,
  LB08a,
  LB09,
  LB10,
  LB11,
  LB12,
  LB12a,
  LB13,
  LB14,
  LB15a,
  LB15b,
  LB15c,
  LB15d,
  LB16,
  LB17,
  LB18,
  LB19,
  LB19a,
  LB20,
  LB20a,
  LB21a, // Must be before LB21
  LB21,
  LB21b,
  LB22,
  LB23,
  LB23a,
  LB24,
  LB25,
  LB26,
  LB27,
  LB28,
  LB28a,
  LB29,
  LB30,
  LB30a,
  LB30b,
  LB31,
];

/**
 * Options for how rules are applied.
 *
 * @typedef {object} RulesOptions
 * @prop {boolean} [string=false] Extract strings from input, rather than just
 *   returning char offsets.
 * @prop {boolean} [verbose=false] Turn on some verbose logging that is
 *   useful for debug.
 */

export class Rules {
  #opts;

  /**
   *
   * @param {RulesOptions} opts
   */
  constructor(opts = {}) {
    /**
     * @type {Required<RulesOptions>}
     */
    this.#opts = {
      string: false,
      example7: false,
      verbose: false,
      ...opts,
    };

    /**
     * Copy of rules, safe to tweak.
     *
     * @type {BreakRule[]}
     */
    this.rules = [...rules];

    if (this.#opts.example7) {
      throw new Error("'example7' flag deprecated");
    }

    if (this.#opts.verbose) {
      this.rules.unshift(state => {
        console.log(state.cur.len, state);
        return PASS;
      });
    }
  }

  /**
   * Remove the rules with names as indicated.
   *
   * @param  {...string} names
   * @returns {BreakRule[]} The deleted rules
   */
  removeRule(...names) {
    /**
     * @type {BreakRule[]}
     */
    const ret = [];
    this.rules = this.rules.filter(r => {
      if (names.includes(r.name)) {
        ret.push(r);
        return false;
      }
      return true;
    });
    return ret;
  }

  /**
   * Add rules after the one named `name`.
   *
   * @param {string} name The name of the rule before.
   * @param {...BreakRule} newRules
   * @returns {number} Index of start of the new rules
   */
  addRuleAfter(name, ...newRules) {
    const i = this.rules.findIndex(r => r.name === name);
    if (i === -1) {
      throw new Error(`Rule not found: "${name}"`);
    }
    this.rules.splice(i + 1, 0, ...newRules);
    return i + 1;
  }

  /**
   * Add rules before the one named `name`.
   *
   * @param {string} name The name of the rule before.
   * @param {...BreakRule} newRules
   * @returns {number} Index of start of the new rules
   */
  addRuleBefore(name, ...newRules) {
    const i = this.rules.findIndex(r => r.name === name);
    if (i === -1) {
      throw new Error(`Rule not found: "${name}"`);
    }
    this.rules.splice(i, 0, ...newRules);
    return i;
  }

  /**
   * Replace the rule named `name` with the given rules.
   *
   * @param {string} name The name of the rule before.
   * @param {...BreakRule} newRules
   * @returns {BreakRule[]} The replaced rules.
   */
  replaceRule(name, ...newRules) {
    const i = this.rules.findIndex(r => r.name === name);
    if (i === -1) {
      throw new Error(`Rule not found: "${name}"`);
    }
    return this.rules.splice(i, 1, ...newRules);
  }

  /**
   *
   * @param {BreakerState} state
   * @returns {Break?}
   */
  #execRules(state) {
    for (const rule of this.rules) {
      const res = rule.call(this, state);
      switch (res) {
        case PASS:
          break;
        case NO_BREAK:

          if (this.#opts.verbose) {
            console.log(`  ${rule.name}: NO_BREAK`);
          }
          return null;
        case MAY_BREAK:

          if (this.#opts.verbose) {
            console.log(`  ${rule.name}: MAY_BREAK`);
          }
          return new Break(state.cur.len);
        case MUST_BREAK:

          if (this.#opts.verbose) {
            console.log(`  ${rule.name}: MUST_BREAK`);
          }
          return new Break(state.cur.len, true);
        default:
          throw new Error(`Invalid state: "${res}"`);
      }
    }
    return null;
  }

  /**
   * @param {BreakerState} state
   */
  * #exec(state) {
    const res = this.#execRules(state);
    if (res) {
      if (this.#opts.string) {
        res.string = state.str.slice(state.prevChunk, state.cur.len);
      }
      if (state.props) {
        res.props = state.props;
        state.props = undefined;
      }
      yield res;
      state.prevChunk = state.cur.len;
    }
  }

  /**
   * Enumerate all of the potential line breaks.
   *
   * @param {string} str
   */
  * breaks(str) {
    const state = new BreakerState(str, this.#opts.work);

    for (const step of state.codePoints(0)) {
      state.push(step);
      yield* this.#exec(state);
    }
    state.pushEnd();
    yield* this.#exec(state);
  }
}
