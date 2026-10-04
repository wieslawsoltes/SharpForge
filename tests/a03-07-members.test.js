import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AssemblyInspector, MetadataBuilder, createMetadataVerificationContext as create,
  methodSignature, fieldSignature, codedIndex,
} from '@sharpforge/cil';
import { metadataImage } from './fixtures/a03-metadata/fixture.js';
import { memberFixture } from './fixtures/a03-verifier-members/input.js';

const fails = code => error => error.name === 'CilError' && error.code === code;
const fixture = (options, decorate) => {
  const input = memberFixture(decorate);
  const inspector = new AssemblyInspector(input.bytes);
  return { ...input, inspector, context: create(inspector, options) };
};

test('local declaration references resolve overloads, instance methods and fields to canonical identities', () => {
  const { context, tokens } = fixture();
  for (const [name, token] of [['field', 0x04000001], ['intMethod', 0x06000001], ['stringMethod', 0x06000002],
    ['instance', 0x06000003], ['privateMethod', 0x06000004], ['localType', 0x06000005]]) {
    const result = context.resolveMember(tokens[name]);
    assert.equal(result.status, 'known');
    assert.equal(result.value, context.resolveMember(token).value);
    assert.equal(result.value.owner, context.resolveType(tokens.owner).value);
    assert.ok(Object.isFrozen(result.value));
    assert.ok(Object.isFrozen(result.value.signature));
  }
  assert.ok(Object.isFrozen(context.resolveMember(tokens.intMethod).value.signature.parameters));
  assert.equal(context.resolveMember(tokens.instance).value.isStatic, false);
});

test('missing declarations and unresolved signature/owner metadata never bind by spelling', () => {
  const { context, tokens } = fixture();
  assert.equal(context.resolveMember(tokens.missing).reason, 'unresolved-type-reference');
  assert.equal(context.resolveMember(tokens.external).reason, 'unresolved-member-owner');
  assert.equal(context.resolveMember(tokens.unresolvedSignature).status, 'unknown');
});

test('compiler-controlled references, ambiguous declarations and unsupported conventions are explicit unknowns', () => {
  const { context, tokens } = fixture({}, ({ md, type }, tokens) => {
    md.rows[6][3][2] = 0x90;
    const row = md.rows[6][0];
    md.add(6, [...row]);
    tokens.duplicate = md.member(type, 'Pick', methodSignature('int', ['int'], true));
    tokens.vararg = md.add(6, [0, 0, 0x16, md.string('Vararg'), md.blob(new Uint8Array([5, 0, 1])), 1]);
    tokens.spec = md.add(43, [codedIndex('MethodDefOrRef', 0x06000001), md.blob(new Uint8Array([10, 1, 8]))]);
  });
  assert.equal(context.resolveMember(tokens.privateMethod).reason, 'compiler-controlled-reference');
  assert.equal(context.resolveMember(0x06000004).status, 'known');
  assert.equal(context.resolveMember(tokens.duplicate).reason, 'ambiguous-member');
  assert.equal(context.resolveMember(tokens.vararg).reason, 'unsupported-method-convention');
  assert.equal(context.resolveMember(tokens.spec).reason, 'method-instantiation');
});

test('definition signatures and raw token ranges are checked without coercion', () => {
  const { context } = fixture();
  for (const token of [0, 0x0400ffff, 0x01000001, -1, 1n, Symbol('token')]) {
    assert.throws(() => context.resolveMember(token), fails('CILVM0001'));
  }
  const wrong = fixture({}, ({ md }) => { md.rows[6][0][2] &= ~0x10; });
  assert.throws(() => wrong.context.resolveMember(0x06000001), fails('CILVM0001'));
});

test('oversized coded rows cannot turn external owners or signature types into local definitions', () => {
  const { inspector } = fixture();
  inspector.metadata.rows[10][0][0] = 0x08000011;
  assert.throws(() => create(inspector), fails('CILVM0001'));
  const badSignature = fixture({}, ({ md }) => {
    md.rows[4][0][2] = md.blob(new Uint8Array([6, 0x12, 0xc4, 0, 0, 9]));
  });
  assert.throws(() => badSignature.context.resolveMember(0x04000001), fails('CILVM0001'));
});

test('snapshot and query budgets precede expansion and cancellation applies after construction', () => {
  const input = memberFixture();
  const inspector = new AssemblyInspector(input.bytes);
  for (const options of [{ maxMembers: 1 }, { maxMemberBytes: 1 }, { maxMembers: NaN }]) {
    assert.throws(() => create(inspector, options), fails('CILVM0002'));
  }
  const limited = create(inspector, { maxMemberSignatureNodes: 0 });
  assert.throws(() => limited.resolveMember(0x06000001), fails('CILVM0002'));
  const one = create(inspector, { maxMemberSignatureNodes: 1 });
  assert.throws(() => one.resolveMember(0x06000001), fails('CILVM0002'));
  const controller = new AbortController();
  const cancelled = create(inspector, { signal: controller.signal });
  controller.abort();
  assert.throws(() => cancelled.resolveMember(0x06000001), fails('CILVM0003'));
});

test('owned snapshots survive changes to source metadata and do not leak mutable signature arrays', () => {
  const { context, inspector, tokens } = fixture();
  inspector.metadata.rows[6][0][2] = 0;
  inspector.metadata.blob(inspector.metadata.rows[6][0][4]).fill(0);
  const member = context.resolveMember(tokens.intMethod).value;
  assert.equal(member.isStatic, true);
  assert.equal(member.signature.parameters[0].name, 'int');
  assert.throws(() => { member.signature.parameters.push({}); }, TypeError);
});

test('pointer-table ownership is reused and duplicate physical ownership rejects', () => {
  const builder = new MetadataBuilder('PointerMembers', { uncompressed: true });
  for (const [name, start] of [['<Module>', 1], ['One', 1], ['Two', 2]]) {
    builder.addRow('TypeDef', { Flags: 1, Name: name, Namespace: '', Extends: 0, FieldList: start, MethodList: 1 });
  }
  for (const name of ['Second', 'First']) builder.addRow('Field', { Flags: 6, Name: name, Signature: fieldSignature('int') });
  builder.add(3, [2]);
  builder.add(3, [1]);
  const context = create(new AssemblyInspector(metadataImage(builder)));
  assert.equal(context.resolveMember(0x04000001).value.owner.token, 0x02000003);
  builder.rows[3][1][0] = 2;
  assert.throws(() => create(new AssemblyInspector(metadataImage(builder))), fails('CILVM0001'));
});

test('twelve native ResolveMember results agree with local declaration resolution', () => {
  const capture = JSON.parse(readFileSync(new URL('./fixtures/a03-verifier-members/native.json', import.meta.url), 'utf8'));
  assert.equal(capture.execution.exitCode, 0);
  const { context } = fixture();
  const members = JSON.parse(capture.execution.stdout).members;
  assert.equal(members.length, 12);
  for (const member of members) {
    const result = context.resolveMember(member.token);
    assert.equal(result.status, 'known');
    assert.equal(result.value.token, member.definition);
    assert.equal(result.value.owner.token, member.owner);
    for (const key of ['name', 'flags', 'kind']) assert.equal(result.value[key], member[key]);
  }
});
