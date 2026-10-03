import { ownText } from '../green.js';
/**
 * Error recovery that never drops source text: unexpected tokens are skipped into SkippedTokensTrivia attached to the
 * next token the parser consumes, and absent tokens are represented by zero-width missing tokens (see Parser.expect).
 */
export const recoveryMethods = {
  /** Skips the current token; its full text becomes skipped-token trivia on the next consumed token. */
  skip() { const token = this.tokens[this.i]; if (token.kind === 'eof') return false; this.skippedTokens.push(token); this.i++; return true; },
  /** Skips every remaining token (used when the nesting budget is exhausted). */
  skipRest() { const tokens = this.tokens, last = tokens.length - 1; while (this.i < last) this.skippedTokens.push(tokens[this.i++]); },
  /** Skips tokens until `stop(token)` holds or the end of file. */
  skipUntil(stop) { while (!this.at('eof') && !stop(this.current)) this.skip(); },
  /** Reports the current token as unexpected and skips it. */
  skipUnexpected(code = 'CS1525', message = `Unexpected token '${this.current.text}'`) { this.error(this.current, code, message); return this.skip(); },
  /** The pending skipped tokens as one SkippedTokensTrivia (their leading trivia, text and trailing trivia). */
  takeSkipped() {
    const first = this.skippedTokens[0], last = this.skippedTokens.at(-1); this.skippedTokens = [];
    const start = first.leadingTrivia[0]?.start ?? first.start, end = last.trailingTrivia.at(-1)?.end ?? last.end;
    return this.cache.trivia('SkippedTokensTrivia', ownText(this.source.text.slice(start, end)));
  },
  /** Trivia list holding any pending skipped tokens followed by `pieces` (lexer trivia pieces). Used for synthesized tokens. */
  leadingWithSkipped(pieces = []) {
    const trivia = this.trivia(pieces);
    return this.skippedTokens.length ? Object.freeze([this.takeSkipped(), ...trivia]) : trivia;
  },
  /** The pending skipped tokens are also flushed by interpolation parsers, whose window ends at a synthetic end-of-file token. */
};
