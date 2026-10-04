import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AssemblyInspector, createMetadataVerificationContext as create, codedIndex } from '@sharpforge/cil';
import { inheritedMemberFixture, inheritedKnownCases } from './fixtures/a03-verifier-members/inherited-input.js';

const fails = code => error => error.name === 'CilError' && error.code === code;
const fixture = (options = {}, decorate) => {
  const input = inheritedMemberFixture(decorate);
  const inspector = new AssemblyInspector(input.bytes);
  return { ...input, inspector, context: create(inspector, options) };
};

test('inherited MemberRefs bind nearest exact field or method declarations to canonical identities', () => {
  const { context, tokens } = fixture();
  for (const [name, definition] of Object.entries(inheritedKnownCases)) {
    const actual = context.resolveMember(tokens[name]);
    assert.equal(actual.status, 'known', name);
    assert.equal(actual.value, context.resolveMember(definition).value, name);
    assert.equal(context.resolveMember(tokens[name]), actual, 'MemberRef cache retains the same result');
  }
  assert.equal(context.resolveMember(tokens.hiddenMethod).value.owner.token, tokens.middle);
  assert.equal(context.resolveMember(tokens.inheritedOverload).value.owner.token, tokens.base);
});

test('private declaration resolution remains separate from accessibility and constructors do not inherit', () => {
  const { context, tokens } = fixture();
  const member = context.resolveMember(tokens.privateMethod).value;
  assert.equal(context.isMemberAccessible(member, context.resolveType(tokens.child).value).value, false);
  assert.equal(context.resolveMember(tokens.inheritedConstructor).reason, 'unresolved-member-declaration');
  assert.equal(context.resolveMember(tokens.missing).reason, 'unresolved-type-reference');
});

test('nearest compiler-controlled or ambiguous declarations never fall back to a base declaration', () => {
  const controlled = fixture({}, ({ md }) => { md.rows[6][4][2] = 0x90; });
  assert.equal(controlled.context.resolveMember(controlled.tokens.hiddenMethod).reason, 'compiler-controlled-reference');
  const ambiguous = fixture({}, ({ md }) => {
    md.rows[4][3][2] = md.rows[4][2][2];
  });
  assert.equal(ambiguous.context.resolveMember(ambiguous.tokens.hiddenField).reason, 'ambiguous-member');
});

test('unresolved generic and external ancestry never grants an inherited declaration', () => {
  const generic = fixture({}, ({ md }, tokens) => {
    md.add(42, [0, 0, codedIndex('TypeOrMethodDef', tokens.middle), md.string('T')]);
  });
  assert.equal(generic.context.resolveMember(generic.tokens.inheritedField).reason, 'generic-definition');
  const external = fixture({}, ({ md }) => {
    md.rows[2][3][3] = codedIndex('TypeDefOrRef', md.typeRef('Foreign.Middle', 'Another.Assembly'));
  });
  assert.equal(external.context.resolveMember(external.tokens.inheritedField).reason, 'unresolved-type-reference');
  const iface = fixture({}, ({ md }) => { md.rows[2][3][0] |= 0xa0; md.rows[2][3][3] = 0; });
  assert.equal(iface.context.resolveMember(iface.tokens.inheritedField).reason, 'unresolved-member-declaration');
});

test('base-chain budgets are checked before traversal while direct declarations keep the zero-budget path', () => {
  for (const options of [{ maxDepth: 0 }, { maxQueryNodes: 1 }]) {
    const { context, tokens } = fixture(options);
    assert.equal(context.resolveMember(tokens.baseField).status, 'known');
    assert.throws(() => context.resolveMember(tokens.inheritedField), fails('CILVM0002'));
  }
  const shallow = fixture({ maxDepth: 1 });
  assert.equal(shallow.context.resolveMember(shallow.tokens.hiddenField).status, 'known');
  assert.throws(() => shallow.context.resolveMember(shallow.tokens.inheritedField), fails('CILVM0002'));
  const controller = new AbortController();
  const cancelled = fixture({ signal: controller.signal });
  cancelled.context.resolveMember(cancelled.tokens.inheritedField);
  controller.abort();
  assert.throws(() => cancelled.context.resolveMember(cancelled.tokens.inheritedField), fails('CILVM0003'));
});

test('inherited lookup uses owned hierarchy and member snapshots after source metadata changes', () => {
  const { context, tokens, inspector } = fixture();
  inspector.metadata.rows[2][3][3] = 0;
  inspector.metadata.rows[4][0][0] = 0;
  inspector.metadata.blob(inspector.metadata.rows[4][0][2]).fill(0);
  assert.equal(context.resolveMember(tokens.inheritedField).value, context.resolveMember(0x04000001).value);
  assert.equal(context.resolveMember(tokens.inheritedField).value.flags, 0x16);
});

test('pinned native inherited ResolveMember observations retain fixture and source provenance', () => {
  const capture = JSON.parse(readFileSync(new URL('./fixtures/a03-verifier-members/inherited-native.json', import.meta.url), 'utf8'));
  const { bytes, context, tokens } = fixture();
  const hash = value => createHash('sha256').update(value).digest('hex');
  const template = readFileSync(new URL('./fixtures/a03-verifier-members/InheritedProgram.cs', import.meta.url), 'utf8');
  const names = [...Object.keys(inheritedKnownCases), 'inheritedConstructor', 'missing'];
  const source = template.replace('ASSEMBLY_BASE64', Buffer.from(bytes).toString('base64'))
    .replace('MEMBER_TOKENS', names.map(name => tokens[name]).join(', '));
  assert.equal(capture.templateSHA256, hash(template));
  assert.equal(capture.sourceSHA256, hash(source));
  assert.equal(capture.fixtureSHA256, hash(bytes));
  assert.equal(capture.inputSHA256, hash(readFileSync(new URL('./fixtures/a03-verifier-members/inherited-input.js', import.meta.url))));
  assert.equal(capture.execution.exitCode, 0);
  assert.equal(capture.execution.signal, null);
  const observations = JSON.parse(capture.execution.stdout).members;
  assert.equal(observations.length, Object.keys(inheritedKnownCases).length + 2);
  for (const [name, definition] of Object.entries(inheritedKnownCases)) {
    const native = observations.find(value => value.token === tokens[name]);
    const actual = context.resolveMember(tokens[name]).value;
    assert.equal(native.success, true);
    assert.equal(native.definition, definition);
    assert.equal(native.definition, actual.token);
    assert.equal(native.owner, actual.owner.token);
    for (const key of ['name', 'kind', 'flags']) assert.equal(native[key], actual[key]);
  }
  for (const name of ['inheritedConstructor', 'missing']) {
    const native = observations.find(value => value.token === tokens[name]);
    assert.equal(native.success, false);
    assert.equal(native.error, 'MissingMethodException');
    assert.equal(context.resolveMember(tokens[name]).status, 'unknown');
  }
});
