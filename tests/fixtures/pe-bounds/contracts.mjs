import assert from 'node:assert/strict';
import { CilError, readPE } from '@sharpforge/cil';
import { acceptedCases } from './input.mjs';

export const baselineCommit = '75f0caad1c3ea096a656feb2989b867781edc82f';

/** Native acceptance is observed independently, never substituted for the explicit SharpForge bounds policy. */
export function compareAuthored(bytes, id, native) {
  const accepted = acceptedCases.includes(id.slice(id.indexOf(':') + 1));
  let product;
  try {
    const pe = readPE(bytes);
    product = { status: 'accepted', headers: { machine: pe.machine, sectionCount: pe.sectionCount,
      sizeOfHeaders: pe.sizeOfHeaders, sections: pe.sections.map(({ name, rva, virtualSize, size, offset }) =>
        ({ name, rva, virtualSize, size, offset })) } };
  } catch (error) {
    assert.ok(error instanceof CilError, `${id}: all product rejections must be CilError`);
    assert.ok(Number.isInteger(error.offset) && error.offset >= 0, `${id}: diagnostic file offset`);
    product = { status: 'rejected', error: { name: error.name, message: error.message, offset: error.offset } };
  }
  assert.equal(product.status, accepted ? 'accepted' : 'rejected', `${id}: declared product policy`);
  let relation;
  if (accepted && native.headers) {
    assert.deepEqual(product.headers, native.headers, `${id}: independently read header facts`);
    relation = 'both-accept-header-facts-equal';
  } else if (accepted) relation = 'product-accepts-native-rejects';
  else relation = native.headers ? 'product-rejects-native-accepts-headers' : 'both-reject';
  return { id, product, native, relation, acceptanceParityRequired: false };
}
