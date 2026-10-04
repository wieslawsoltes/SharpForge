/** Runtime ref-struct descriptors contain metadata only and never import execution state. */
export function memoryMethodTable(name, nativeIntBits = 32) {
  if (name !== 'System.Span`1' && name !== 'System.ReadOnlySpan`1') return null;
  return {base: 'System.ValueType', flags: {valueType: true, refStruct: true, sealed: true},
    valueSize: nativeIntBits / 4, variance: [0]};
}
