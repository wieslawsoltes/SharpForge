const memory = 'SharpForge.Runtime.FixedMemory';

/** Private lowering ABI in A06's reserved range; all offsets are in pointed-at elements. */
export function registerGCFixedContracts({define, member}) {
  define(memory, {kind: 'static', runtimeHandler: 'gc', family: 'gcFixedMemory'});
  define('SharpForge.Runtime.FixedPointer', {kind: 'gc', runtimeHandler: 'gc', family: 'gcFixedPointer'});
  const operation = (name, parameters, result) => member(memory, name, parameters, result, {isStatic: true, internal: true});
  operation('Pin', ['object', 'int', 'string', 'bool'], 'object');
  operation('Release', ['object'], 'void');
  operation('Add', ['object', 'int'], 'object');
  operation('Cast', ['object', 'string'], 'object');
  operation('Compare', ['object', 'object', 'string'], 'bool');
  operation('SmallInteger', ['int', 'string', 'bool'], 'int');
  for (const [suffix, type] of [['Int32', 'int'], ['Double', 'double'], ['Boolean', 'bool']]) {
    operation('Read' + suffix, ['object', 'int'], type);
    operation('Write' + suffix, ['object', 'int', type], type);
  }
}
