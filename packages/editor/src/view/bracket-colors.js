const opening = new Set(['(', '[', '{']);
const closing = new Map([[')', '('], [']', '['], ['}', '{']]);

/** Chunked token decoration pass; no regular expressions see string/comment contents as brackets. */
export class BracketColors {
  constructor(editor) { this.editor = editor; this.generation = 0; this.depths = new Map(); this.pairs = new Map(); }

  update() {
    const generation = ++this.generation;
    const tokens = this.editor.highlightIndex.tokens;
    this.depths.clear();
    this.pairs.clear();
    if (!tokens || !this.editor.options.bracketColors) return;
    let index = 0;
    const stack = [];
    const work = () => {
      if (this.editor.disposed || generation !== this.generation) return;
      const end = Math.min(tokens.length, index + 2048);
      for (; index < end; index++) {
        const token = tokens.get(index);
        if (opening.has(token.kind)) {
          const depth = stack.length;
          stack.push({kind: token.kind, start: token.start, depth});
          this.depths.set(token.start, depth);
        } else if (closing.has(token.kind)) {
          const open = stack.pop();
          if (open?.kind !== closing.get(token.kind)) { stack.length = 0; continue; }
          this.depths.set(token.start, open.depth);
          this.pairs.set(open.start, token.start);
          this.pairs.set(token.start, open.start);
        }
      }
      if (index < tokens.length) this.timer = setTimeout(work, 0);
      else this.editor.view.schedule();
    };
    work();
  }

  render() {
    const {editor} = this;
    const at = this.pairs.has(editor.offset) ? editor.offset : editor.offset - 1;
    const other = this.pairs.get(at);
    for (const node of editor.view.lines.layer.querySelectorAll('[data-bracket]')) {
      const offset = Number(node.dataset.bracket);
      const depth = this.depths.get(offset);
      node.style.color = editor.options.bracketColors && depth !== undefined ? `var(--sf-bracket-${depth % 6})` : '';
      const match = other !== undefined && (offset === at || offset === other);
      node.classList.toggle('sf-bracket-match', match && editor.options.bracketMatchStyle === 'rectangle');
      node.classList.toggle('sf-bracket-bold', match && editor.options.bracketMatchStyle === 'bold');
    }
  }

  dispose() { this.generation++; clearTimeout(this.timer); this.depths.clear(); this.pairs.clear(); }
}
