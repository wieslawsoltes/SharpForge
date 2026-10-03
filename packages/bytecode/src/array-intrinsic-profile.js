const definitions = [];
function add(name, parameters, returnType, isStatic = true, genericArity = 0) {
  definitions.push(Object.freeze({
    owner: 'System.Array', name, parameters: Object.freeze(parameters), returnType, isStatic, genericArity
  }));
}
for (const integer of ['int', 'long']) {
  add('Copy', ['System.Array', 'System.Array', integer], 'void');
  add('Copy', ['System.Array', integer, 'System.Array', integer, integer], 'void');
}
add('Clear', ['System.Array'], 'void');
add('Clear', ['System.Array', 'int', 'int'], 'void');
for (const count of [0, 1, 2]) add('IndexOf', ['System.Array', 'object', ...Array(count).fill('int')], 'int');
add('Resize', ['!!0[]&', 'int'], 'void', true, 1);
add('Clone', [], 'object', false);
for (const property of ['Rank', 'Length']) add('get_' + property, [], 'int', false);
add('get_LongLength', [], 'long', false);
for (const name of ['GetLength', 'GetLowerBound', 'GetUpperBound']) add(name, ['int'], 'int', false);
add('GetLongLength', ['int'], 'long', false);

/** Appended source builtin descriptors; existing released IDs never move. */
export const arrayIntrinsicDefinitions = Object.freeze(definitions);
