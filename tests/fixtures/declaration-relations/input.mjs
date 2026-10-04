import { codedIndex } from '@sharpforge/cil';
import { managedFixture } from '../../managed-fixtures.js';

export const declarationTokens = Object.freeze({ root: 0x02000002, middle: 0x02000003, hidden: 0x02000004,
  leaf: 0x02000005, reimplemented: 0x02000006, contract: 0x02000007, childContract: 0x02000008,
  rootM: 0x06000001, rootOther: 0x06000002, middleM: 0x06000003, explicitOther: 0x06000004,
  hiddenM: 0x06000005, leafM: 0x06000006, reimplementedM: 0x06000007, contractM: 0x06000008, contractOther: 0x06000009 });

/** Independently authored metadata for interface inheritance, explicit maps, newslot hiding and reimplementation. */
export function declarationFixture({ memberRef = false, memberRefBody = false, decorate } = {}) {
  const tokens = declarationTokens;
  const method = (name, flags = 0x1c6) => ({ name, flags, static: false, parameters: ['int'], result: 'int',
    noBody: Boolean(flags & 0x400), body: writer => writer.op('ldarg.1').op('ret') });
  return managedFixture({ name: 'DeclarationRelations', entry: null, methods: [
    method('M'), method('Other'), method('M', 0xc6), method('IContract.Other', 0x1e1), method('M'),
    method('M', 0xe6), method('M'), method('M', 0x5c6), method('Other', 0x5c6),
  ], decorate({ md }) {
    md.rows[2][1][1] = md.string('Root');
    const addType = (name, base, start, flags = 1) => md.add(2, [flags, md.string(name), md.string('Fixture'),
      base ? codedIndex('TypeDefOrRef', base) : 0, 1, start]);
    addType('Middle', tokens.root, 3);
    addType('Hidden', tokens.middle, 5);
    addType('Leaf', tokens.middle, 6);
    addType('Reimplemented', tokens.hidden, 7);
    addType('IContract', 0, 8, 0xa1);
    addType('IChild', 0, 10, 0xa1);
    for (const [owner, contract] of [[2, tokens.contract], [3, tokens.contract], [6, tokens.childContract], [8, tokens.contract]]) {
      md.add(9, [owner, codedIndex('TypeDefOrRef', contract)]);
    }
    const signature = md.rows[6][3][4];
    const alias = md.add(1, [codedIndex('ResolutionScope', 1), md.string('IContract'), md.string('Fixture')]);
    const declaration = memberRef ? md.add(10, [codedIndex('MemberRefParent', alias), md.string('Other'), signature])
      : tokens.contractOther;
    const body = memberRefBody ? md.add(10, [codedIndex('MemberRefParent', tokens.middle), md.string('IContract.Other'), signature])
      : tokens.explicitOther;
    md.add(25, [3, codedIndex('MethodDefOrRef', body), codedIndex('MethodDefOrRef', declaration)]);
    decorate?.({ md, tokens, body, declaration, signature });
  } });
}
