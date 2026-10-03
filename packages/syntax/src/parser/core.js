import { diagnostic } from '@sharpforge/text';
export const modifiers = new Set(['public','private','protected','internal','static','readonly','const','sealed','partial','virtual','override','abstract','async']);
export const typeKeywords = new Set(['int','double','float','bool','string','object','char','void','var','long','decimal','uint','ulong','short','byte']);
export const precedence = { '??=':1, '=':1, '+=':1, '-=':1, '*=':1, '/=':1, '%=':1, '&=':1, '|=':1, '^=':1, '??':3, '||':4, '&&':5, '|':6, '^':7, '&':8, '==':9, '!=':9, '<':10, '>':10, '<=':10, '>=':10, 'is':10, 'as':10, '<<':11, '>>':11, '+':12, '-':12, '*':13, '/':13, '%':13 };
export class Parser {
  constructor(lexed) { Object.assign(this, lexed); this.diagnostics = [...lexed.diagnostics]; this.i = 0; this.depth = 0; this.nodeCount = 0; this.namespaceName=''; }
  get current() { return this.tokens[this.i]; }
  at(k) { return this.current.kind === k; }
  peek(n = 1) { return this.tokens[Math.min(this.tokens.length - 1, this.i + n)]; }
  take() { const t = this.current; if (!this.at('eof')) this.i++; return t; }
  match(k) { return this.at(k) ? this.take() : null; }
  error(t, code, message) { if (this.diagnostics.length < 200) this.diagnostics.push(diagnostic(this.source, t.start, Math.max(1, t.end - t.start), code, message)); }
  expect(k) { if (this.at(k)) return this.take(); this.error(this.current, 'CS1003', `'${k}' expected`); return {kind:k, start:this.current.start, end:this.current.start, text:'', value:'', missing:true}; }
  node(kind, start, props = {}) { this.nodeCount++; return { kind, start: typeof start === 'number' ? start : start.start, end: this.tokens[Math.max(0, this.i - 1)].end, uri:this.source.uri, ...props }; }
  guardProgress(before) { if (before === this.i && !this.at('eof')) { this.error(this.current, 'CS1525', `Unexpected token '${this.current.text}'`); this.take(); } }
}
