import {createHash} from 'node:crypto';
export const fixtureVersion = 1;
export function fixtures(seed = 1) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Seed must be a uint32');
  let state = (seed ^ 0x9e3779b9) >>> 0;
  const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  const randomGraph = [];
  for (let i = 0; i < 24; i++) randomGraph.push({op: 'allocate', id: 'n' + i, fields: 2});
  for (let i = 0; i < 24; i++) for (let field = 0; field < 2; field++) randomGraph.push({op: 'link', id: 'n' + i, field, target: 'n' + (next() % 24)});
  randomGraph.push({op: 'root', id: 'n' + (next() % 24)}, {op: 'collect'}, {op: 'clear-roots'}, {op: 'collect'});
  return [
    {id: 'rooted-cycle', operations: [{op: 'allocate', id: 'a', fields: 1}, {op: 'allocate', id: 'b', fields: 1},
      {op: 'link', id: 'a', field: 0, target: 'b'}, {op: 'link', id: 'b', field: 0, target: 'a'},
      {op: 'root', id: 'a'}, {op: 'collect'}, {op: 'clear-roots'}, {op: 'collect'}]},
    {id: 'strong-and-weak', operations: [{op: 'allocate', id: 'a', fields: 0}, {op: 'allocate', id: 'b', fields: 1},
      {op: 'link', id: 'b', field: 0, target: 'a'}, {op: 'handle', id: 'b', handle: 'strong', weak: false},
      {op: 'handle', id: 'a', handle: 'weak', weak: true}, {op: 'collect'},
      {op: 'release', handle: 'strong'}, {op: 'collect'}]},
    {id: 'generation-reuse', operations: [{op: 'allocate', id: 'old', fields: 0},
      {op: 'handle', id: 'old', handle: 'weak', weak: true}, {op: 'collect'},
      {op: 'allocate', id: 'new', fields: 0}, {op: 'root', id: 'new'}, {op: 'collect'}]},
    {id: 'empty-heap', operations: [{op: 'collect'}, {op: 'collect'}]},
    {id: 'seeded-graph', operations: randomGraph},
  ];
}
export function fixtureDigest(rows) { return createHash('sha256').update(JSON.stringify({fixtureVersion, fixtures: rows})).digest('hex'); }
