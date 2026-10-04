import { codedIndex } from '@sharpforge/cil';
import { TypeKind } from '../packages/clr/src/index.js';
import { baseContext, hierarchyFixture } from './clr-methods-base-fixtures.js';

export function interfaceContext(options = {}) {
  const context = baseContext(options);
  context.types.defineIntrinsic('System.IDisposable', { kind: TypeKind.Interface });
  return context;
}

export function interfaceImplFixture({ memberRef = false, decorate } = {}) {
  return hierarchyFixture(({ md }) => {
    const signature = md.rows[6][5][4];
    md.rows[6][5][2] = 0x1e1;
    md.rows[6][5][3] = md.string('IContract.Other');
    const contract = md.add(2, [0xa1, md.string('IContract'), md.string('Fixture'), 0, 1, 10]);
    const declaration = md.add(6, [0, 0, 0x5c6, md.string('Other'), signature, md.rows[8].length + 1]);
    md.add(9, [3, codedIndex('TypeDefOrRef', contract)]);
    const reference = memberRef ? md.add(10, [codedIndex('MemberRefParent', contract), md.string('Other'), signature]) : declaration;
    md.add(25, [3, codedIndex('MethodDefOrRef', 0x06000006), codedIndex('MethodDefOrRef', reference)]);
    decorate?.({ md, contract, declaration, reference, signature });
  });
}
