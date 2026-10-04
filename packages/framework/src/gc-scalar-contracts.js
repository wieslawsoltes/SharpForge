/** Explicit internal ABI for GC source-profile integers; native CLR GC signatures are unchanged. */
export function registerGCScalarContracts({define, member}) {
  const owner = 'SharpForge.Runtime.GCScalar';
  define(owner, {kind: 'static', runtimeHandler: 'gc', family: 'gcScalar'});
  const add = (name, parameters, result) => member(owner, name, parameters, result, {isStatic: true, internal: true});
  for (const [type, suffix] of [['long', 'Long'], ['nint', 'Native']]) {
    add('Constant' + suffix, ['string'], type);
    add('Binary' + suffix, [type, type, 'string', 'bool'], type);
    add('Shift' + suffix, [type, 'int', 'string'], type);
    add('Compare' + suffix, [type, type, 'string'], 'bool');
    add('Unary' + suffix, [type, 'string', 'bool'], type);
  }
  for (const [type, suffix] of [['long', 'Long'], ['nint', 'Native'], ['int', 'Int32'], ['double', 'Double']]) {
    add('Convert' + suffix, ['object', 'string', 'bool'], type);
  }
}
