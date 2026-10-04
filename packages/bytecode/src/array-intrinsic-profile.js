/** Appended source contracts keep the full CLR member signature beside the wire identity. */
const rows = [];
const add = (name, result, parameters, isStatic = true, operation = name, genericArity = 0) =>
  rows.push({owner: 'System.Array', name, returnType: result, parameters, isStatic, operation, genericArity});

for (const index of ['int', 'long']) {
  add('Copy', 'void', ['System.Array', 'System.Array', index]);
  add('Copy', 'void', ['System.Array', index, 'System.Array', index, index]);
}
add('Clear', 'void', ['System.Array']);
add('Clear', 'void', ['System.Array', 'int', 'int']);
for (let count = 0; count < 3; count++) add('IndexOf', 'int', ['System.Array', 'object', ...Array(count).fill('int')]);
add('Resize', 'void', ['!!0[]&', 'int'], true, 'Resize', 1);
add('Clone', 'object', [], false);
for (const name of ['Rank', 'Length', 'LongLength']) add('get_' + name, name === 'LongLength' ? 'long' : 'int', [], false);
for (const name of ['GetLength', 'GetLongLength', 'GetLowerBound', 'GetUpperBound'])
  add(name, name === 'GetLongLength' ? 'long' : 'int', ['int'], false);
for (let rank = 1; rank <= 3; rank++) add('CreateInstance', 'System.Array', ['System.Type', ...Array(rank).fill('int')]);
for (const lengths of [['int[]'], ['long[]'], ['int[]', 'int[]']]) add('CreateInstance', 'System.Array', ['System.Type', ...lengths]);
for (const index of ['int', 'long']) {
  for (const indices of [[index + '[]'], ...[1, 2, 3].map(rank => Array(rank).fill(index))]) {
    add('GetValue', 'object', indices, false);
    add('SetValue', 'void', ['object', ...indices], false);
  }
}

export const sourceArrayBuiltins = Object.freeze(rows.map((row, index) => {
  const descriptor = Object.freeze({...row, parameters: Object.freeze(row.parameters)});
  const params = Object.freeze([...(row.isStatic ? [] : ['System.Array']), ...row.parameters]);
  return Object.freeze({name: 'Array.' + row.name + '#memory' + index,
    min: params.length, max: params.length, result: row.returnType, params, arrayRuntime: descriptor});
}));

const bridge = (operation, parameters, result) => Object.freeze({
  name: '$memory.' + operation, min: parameters.length, max: parameters.length, result,
  params: Object.freeze(parameters), arrayRuntime: Object.freeze({operation, internal: true})
});
export const sourceMemoryBuiltins = Object.freeze([
  bridge('typeOf', ['string'], 'System.Type'),
  bridge('cast', ['object', 'string'], 'object'),
  bridge('spanFromArray', ['System.Array', 'string'], 'object'),
  bridge('spanFromString', ['string', 'string'], 'object'),
  bridge('spanToArray', ['object'], 'System.Array')
]);
