import { Writer } from '@sharpforge/cil';
import { managedFixture } from '../../managed-fixtures.js';
import { fieldAuthority } from '../verifier-fields/input.js';

export const literalMethodToken = 0x06000001;

/** Ordinary CLI fixture; rawHeap replaces only #US after instruction operands have been emitted. */
export function literalFixture(fixture = {}) {
  let context;
  const literalTokens = [];
  const name = fixture.name ?? 'Single';
  const body = fixture.body ?? ((writer, input) => writer.op('ldstr', input.literal(fixture.text ?? 'literal')).op('ret'));
  const bytes = managedFixture({
    name: 'Literals_' + name,
    entry: null,
    fields: fixture.fields ?? [],
    methods: [{ ...fixture, name, result: fixture.result ?? 'string', body(writer, input) {
      const tokens = { object: input.md.typeRef('System.Object'), valueType: input.md.typeRef('System.ValueType') };
      context = { ...input, tokens, literal(value) {
        const token = 0x70000000 + input.md.userString(value);
        literalTokens.push(token);
        return token;
      } };
      body(writer, context);
    } }],
    decorate(input) {
      if (fixture.rawHeap !== undefined) input.md.heaps.userStrings = new Writer().bytes(fixture.rawHeap);
      fixture.decorate?.(input);
    },
  });
  return { bytes, method: literalMethodToken, tokens: context.tokens, literalTokens };
}

/** Reuse the field corpus's explicit canonical authority; never infer a core type from its name. */
export function literalAuthority(core, input) {
  return fieldAuthority(core, input);
}
