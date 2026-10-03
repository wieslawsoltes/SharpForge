/** Project declared framework shapes into the existing runtime method-table model. */
export function frameworkMethodTable(framework) {
  const isInterface = (framework.typeKind ?? framework.kind) === 'interface';
  const fallbackBase = framework.kind === 'enum' ? 'System.Enum'
    : framework.kind === 'value' ? 'System.ValueType'
      : framework.kind === 'delegate' ? 'System.MulticastDelegate' : 'System.Object';
  return {
    base: isInterface ? null : framework.base ?? fallbackBase,
    interfaces: framework.interfaces ?? [],
    variance: (framework.variance ?? []).map(value => value === 'in' ? -1 : value === 'out' ? 1 : 0),
    flags: {
      valueType: ['value', 'enum'].includes(framework.kind),
      enum: framework.kind === 'enum',
      delegate: framework.kind === 'delegate',
      interface: isInterface,
      abstract: !!framework.isAbstract || isInterface,
      sealed: !!framework.isSealed,
      dynamic: true
    },
    enumUnderlyingType: framework.kind === 'enum' ? 'int' : null,
    fields: []
  };
}
