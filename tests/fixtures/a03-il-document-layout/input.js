import { assembleILDocument, formatILDocument, AssemblyInspector, ilLabel } from '@sharpforge/cil';
import { managedFixture } from '../../managed-fixtures.js';

export function documentLayoutFixture() {
  return managedFixture({ name: 'DocumentLayout', methods: [
    { name: 'Main', result: 'int', initLocals: false, maxStack: 1,
      body: writer => writer.op('br.s', 'done').mark('done').op('ldc.i4', 42).op('ret') },
    { name: 'Catch', result: 'int', locals: ['int'], body: writer => writer.mark('try').op('ldnull').op('throw')
      .mark('catch').op('pop').op('ldc.i4', 42).op('stloc.0').op('leave.s', 'done')
      .mark('handlerEnd').op('nop').mark('done').op('ldloc.0').op('ret'),
      handlers: (labels, context) => [{ start: labels.get('try'), end: labels.get('catch'), target: labels.get('catch'),
        handlerEnd: labels.get('handlerEnd'), catchType: context.resolve('System.Exception') }] },
    { name: 'Filter', result: 'int', locals: ['int'], body: writer => writer.mark('try').op('br', 'throw')
      .mark('throw').op('ldnull').op('throw').mark('filter').op('pop').op('ldc.i4.1').op('endfilter')
      .mark('handler').op('pop').op('ldc.i4', 43).op('stloc.0').op('leave.s', 'done')
      .mark('handlerEnd').op('nop').mark('done').op('ldloc.0').op('ret'),
      handlers: labels => [{ flags: 1, start: labels.get('try'), end: labels.get('filter'), target: labels.get('handler'),
        handlerEnd: labels.get('handlerEnd'), catchType: labels.get('filter') }] },
    { name: 'Switch', result: 'int', body: writer => writer.op('ldc.i4.1').op('switch', ['bad', 'good'])
      .mark('bad').op('ldc.i4.m1').op('ret').mark('good').op('ldc.i4', 44).op('ret') },
  ] });
}

export function editedLayoutDocument(bytes = documentLayoutFixture()) {
  const inspector = new AssemblyInspector(bytes);
  return formatILDocument(bytes).replace(/(\.method (0x[\da-f]+)\n\{)([\s\S]*?)(\n\})/g, (whole, start, token, body, end) => {
    const method = inspector.getMethod(Number(token));
    const branch = method.instructions.find(instruction => instruction.name === 'br.s' || instruction.name === 'leave.s');
    const target = branch?.operand ?? method.instructions.find(instruction => instruction.name === 'switch').operand[1];
    const padding = Array.from({ length: 300 }, (_, index) => `  IL_${(0xf000 + index).toString(16)}: nop`).join('\n');
    return start + body.replace(`  ${ilLabel(target)}:`, padding + `\n  ${ilLabel(target)}:`) + end;
  });
}

export function rebuiltLayoutFixture() {
  return assembleILDocument(editedLayoutDocument(), { relaxBranches: true }).bytes;
}
