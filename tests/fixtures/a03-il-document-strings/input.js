import { AssemblyInspector, assembleILDocument, formatILDocument, ilLabel } from '@sharpforge/cil';
import { managedFixture } from '../../managed-fixtures.js';

export const literal = 'new \"value\" https://example.test/a//b\nλ 🚀\0end';

export function stringFixture() {
  const old = (writer, context) => writer.op('ldstr', 0x70000000 + context.md.userString('old')).op('ret');
  return managedFixture({ name: 'DocumentStrings', entry: null, methods: [
    { name: 'Main', result: 'string', locals: ['int'], body: (writer, context) => writer.op('ldc.i4.0').op('stloc.0')
      .op('br.s', 'test').mark('body').op('ldloc.0').op('ldc.i4.1').op('add').op('stloc.0')
      .mark('test').op('ldloc.0').op('ldc.i4.3').op('blt.s', 'body')
      .op('ldstr', 0x70000000 + context.md.userString('old')).op('ret') },
    { name: 'Original', result: 'string', body: old },
    { name: 'Again', result: 'string', body: old },
  ] });
}

export function literalDocument(bytes = stringFixture(), value = literal, longLoop = true) {
  const inspector = new AssemblyInspector(bytes);
  return formatILDocument(bytes).replace(/(\.method (0x[\da-f]+)\n\{)([\s\S]*?)(\n\})/g, (whole, start, token, body, end) => {
    const method = inspector.getMethod(Number(token));
    if (method.name === 'Original') return whole;
    body = body.replace(/ldstr 0x[\da-f]+[^\n]*/, () => `ldstr ${JSON.stringify(value)} // new literal`);
    if (longLoop && method.name === 'Main') {
      const target = method.instructions.find(instruction => instruction.name === 'br.s').operand;
      const padding = Array.from({ length: 300 }, (_, index) => `  IL_${(0xf000 + index).toString(16)}: nop`).join('\n');
      body = body.replace(`  ${ilLabel(target)}:`, padding + `\n  ${ilLabel(target)}:`);
    }
    return start + body + end;
  });
}

export function rebuiltStringFixture() {
  return assembleILDocument(literalDocument(), { relaxBranches: true }).bytes;
}
