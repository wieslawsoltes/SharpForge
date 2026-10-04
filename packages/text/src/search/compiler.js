import { SearchPatternError } from './errors.js';
import { compilePredicate } from './predicates.js';

function fixedWidth(node) {
  if (['literal', 'any', 'class', 'property', 'builtin'].includes(node.kind)) return 1;
  if (['anchor', 'boundary', 'look'].includes(node.kind)) return 0;
  if (node.kind === 'capture') return fixedWidth(node.child);
  if (node.kind === 'sequence') {
    const lengths = node.children.map(fixedWidth);
    return lengths.some(length => length < 0) ? -1 : lengths.reduce((sum, length) => sum + length, 0);
  }
  if (node.kind === 'choice') {
    const lengths = node.alternatives.map(fixedWidth);
    return lengths.every(length => length === lengths[0]) ? lengths[0] : -1;
  }
  if (node.kind === 'repeat' && node.minimum === node.maximum) {
    const length = fixedWidth(node.child);
    return length < 0 ? -1 : length * node.minimum;
  }
  return -1;
}

function captureIndices(node, result = []) {
  if (node.kind === 'capture') result.push(node.group);
  if (node.child) captureIndices(node.child, result);
  for (const child of node.children ?? node.alternatives ?? []) captureIndices(child, result);
  return result;
}

/** Compile to bounded bytecode; repetition expands only within an explicit instruction budget. */
export function compileRegex(parsed, options, budget) {
  const context = { instructions: 0, slots: (parsed.groups + 1) * 2, maximum: options.maxInstructions ?? 16384 };
  const build = (root, captureWhole) => {
    const code = [];
    const emit = instruction => {
      budget.tick();
      if (++context.instructions > context.maximum) throw new SearchPatternError('Regex instruction limit exceeded', root.position ?? 0);
      code.push(instruction);
      return code.length - 1;
    };
    const compileChoice = node => {
      const exits = [];
      for (let index = 0; index < node.alternatives.length - 1; index++) {
        const branch = emit({ op: 'split', first: code.length + 1, second: -1 });
        visit(node.alternatives[index]);
        exits.push(emit({ op: 'jump', target: -1 }));
        code[branch].second = code.length;
      }
      visit(node.alternatives.at(-1));
      for (const exit of exits) code[exit].target = code.length;
    };
    const compileRepeat = node => {
      const captures = captureIndices(node.child);
      const body = () => {
        if (captures.length) emit({ op: 'reset', captures });
        visit(node.child);
      };
      for (let index = 0; index < node.minimum; index++) body();
      if (node.maximum === Infinity) {
        const branch = emit({ op: 'split', first: -1, second: -1 });
        const bodyStart = code.length;
        const slot = context.slots++;
        emit({ op: 'save', slot });
        body();
        const guard = emit({ op: 'progress', slot, target: branch, exit: -1 });
        const exit = code.length;
        code[guard].exit = exit;
        code[branch].first = node.lazy ? exit : bodyStart;
        code[branch].second = node.lazy ? bodyStart : exit;
      } else {
        for (let index = node.minimum; index < node.maximum; index++) {
          const branch = emit({ op: 'split', first: -1, second: -1 });
          const bodyStart = code.length;
          body();
          code[branch].first = node.lazy ? code.length : bodyStart;
          code[branch].second = node.lazy ? bodyStart : code.length;
        }
      }
    };
    const visit = node => {
      if (node.kind === 'sequence') for (const child of node.children) visit(child);
      else if (node.kind === 'choice') compileChoice(node);
      else if (node.kind === 'repeat') compileRepeat(node);
      else if (node.kind === 'capture') {
        emit({ op: 'save', slot: node.group * 2 });
        visit(node.child);
        emit({ op: 'save', slot: node.group * 2 + 1 });
      } else if (node.kind === 'look') {
        const width = node.behind ? fixedWidth(node.child) : 0;
        if (width < 0) throw new SearchPatternError('Lookbehind must have fixed scalar length', node.position, 'SEARCH_UNSUPPORTED_PATTERN');
        emit({ op: 'look', code: build(node.child, false), negative: node.negative, behind: node.behind, width });
      } else if (node.kind === 'backref') {
        const group = node.name ? parsed.names[node.name] : node.group;
        if (!group || group > parsed.groups) throw new SearchPatternError('Unknown backreference', node.position);
        emit({ op: 'backref', group });
      } else if (node.kind === 'anchor' || node.kind === 'boundary') emit({ op: node.kind, ...node });
      else emit({ op: 'character', test: compilePredicate(node, options) });
    };
    if (captureWhole) emit({ op: 'save', slot: 0 });
    visit(root);
    if (captureWhole) emit({ op: 'save', slot: 1 });
    emit({ op: 'accept' });
    return code;
  };
  const code = build(parsed.node, true);
  return Object.freeze({ code, slots: context.slots, groups: parsed.groups, names: parsed.names, options });
}
