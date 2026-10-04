import { codedIndex } from '@sharpforge/cil';
import { graphContext } from './clr-types-graph-fixtures.js';
import { managedFixture } from './managed-fixtures.js';

export function baseContext(options = {}) {
  const context = graphContext(options);
  context.types.defineIntrinsic('System.Void');
  context.types.defineIntrinsic('System.String', { baseType: context.types.intrinsic('System.Object') });
  return context;
}

export function hierarchyFixture(decorate) {
  const method = (name, parameter = 'int', flags = 0x1c6) => ({ name, parameters: [parameter], result: 'int', flags, static: false, noBody: true });
  return managedFixture({ name: 'OverrideHierarchy', entry: null, methods: [
    method('M'), method('M', 'string'), method('Reset'),
    method('M', 'int', 0xc6), method('Reset'), method('Plain', 'int', 0x86),
    method('M', 'int', 0xe6), method('M', 'string', 0xc6), method('Reset', 'int', 0xc6),
  ], decorate({ md, ...rest }) {
    md.add(2, [1, md.string('Middle'), 0, codedIndex('TypeDefOrRef', 0x02000002), 1, 4]);
    md.add(2, [1, md.string('Leaf'), 0, codedIndex('TypeDefOrRef', 0x02000003), 1, 7]);
    decorate?.({ md, ...rest });
  } });
}
