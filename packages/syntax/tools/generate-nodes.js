/** Generates packages/syntax/src/generated/nodes.js from grammar/syntax.json. Run: node packages/syntax/tools/generate-nodes.js [--check] */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const grammarPath = fileURLToPath(new URL('../src/grammar/syntax.json', import.meta.url)),
  outputPath = fileURLToPath(new URL('../src/generated/nodes.js', import.meta.url));
export function generateNodes(grammar) {
  const upper = s => s[0].toUpperCase() + s.slice(1),
    lower = s => s[0].toLowerCase() + s.slice(1);
  const names = [],
    types = [],
    classes = [],
    factories = [];
  for (const [syntax, kindList, slotList] of grammar.nodes) {
    const kinds = kindList.split(' '),
      slots = slotList.split(' ').map(slot => {
        const m = /^(\w+)(,\*|\*|\?)?$/.exec(slot);
        if (!m) throw new Error(`Bad slot '${slot}' in ${syntax}`);
        return { name: m[1], type: m[2] === ',*' ? 2 : m[2] === '*' ? 1 : 0, optional: m[2] === '?' };
      });
    if (new Set(slots.map(s => s.name)).size !== slots.length) throw new Error(`Duplicate slot in ${syntax}`);
    for (const kind of kinds) {
      names.push(`  ${kind}: [${slots.map(s => `'${s.name}'`).join(', ')}]`);
      types.push(`  ${kind}: '${slots.map(s => (s.optional ? 3 : s.type)).join('')}'`);
    }
    const members = slots.map((s, i) => {
      const read = s.type ? `this.list(${i}${s.type === 2 ? ', true' : ''})` : `this.slot(${i})`;
      return `  get ${s.name}() { return ${read}; }\n  with${upper(s.name)}(value) { return this.withSlot(${i}, value); }`;
    });
    const quotedKinds = kinds.map(k => `'${k}'`).join(', ');
    classes.push(
      `export class ${syntax}Syntax extends SyntaxNode {\n${members.join('\n')}\n}\nregisterNodeClass([${quotedKinds}], ${syntax}Syntax);`
    );
    const args = slots.map(s => (['default', 'else', 'finally', 'arguments'].includes(s.name) ? s.name + '_' : s.name)).join(', ');
    factories.push(
      kinds.length > 1
        ? `  ${lower(syntax)}(kind, ${args}) { return make(kind, [${args}]); }`
        : `  ${lower(syntax)}(${args}) { return make('${kinds[0]}', [${args}]); }`
    );
  }
  return `/** Generated from grammar/syntax.json by tools/generate-nodes.js. Do not edit by hand. */
import { GreenNode } from '../green.js';
import { SyntaxNode, registerNodeClass, createNode } from '../red.js';
/** Child slot names per node kind, in Roslyn order. */
export const slotNames = Object.freeze({
${names.join(',\n')}
});
/** Slot shapes per node kind, one digit per slot: 0 required child, 1 list, 2 separated list, 3 optional child. */
export const slotTypes = Object.freeze({
${types.join(',\n')}
});
const unwrap = value => {
  if (Array.isArray(value)) return value.length ? new GreenNode('SyntaxList', value.map(unwrap)) : null;
  return value && value.green ? value.green : value ?? null;
};
const make = (kind, children) => createNode(new GreenNode(kind, children.map(unwrap)), null, 0);
${classes.join('\n')}
/** Factories returning detached nodes; children may be red or green elements, arrays for lists, or null. */
export const SyntaxFactory = Object.freeze({
${factories.join(',\n')}
});
`;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = generateNodes(JSON.parse(readFileSync(grammarPath, 'utf8')));
  if (process.argv.includes('--check')) {
    if (readFileSync(outputPath, 'utf8') !== output) {
      console.error('generated/nodes.js is stale; run node packages/syntax/tools/generate-nodes.js');
      process.exitCode = 1;
    }
  } else {
    writeFileSync(outputPath, output);
    console.log('Wrote ' + outputPath);
  }
}
