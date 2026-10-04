const load = (writer, input, value = 'literal') => writer.op('ldstr', input.literal(value));
const accepted = (name, options = {}) => ({ name, status: 'verified', ...options });
const rejected = (name, options = {}) => ({ name, status: 'rejected', diagnostic: 'StackUnexpected', ...options });
const textField = { name: 'Text', type: 'string' };

/** Expected policies and native outcomes are declared before any oracle process runs. */
export const literalCases = [
  accepted('StringReturn'),
  accepted('ObjectReturn', { result: 'object' }),
  accepted('Empty', { text: '' }),
  accepted('Unicode', { text: 'Zażółć gęślą jaźń λ 🚀\0end' }),
  accepted('Surrogates', { text: '\ud800\udfff\ud800A\udfff' }),
  accepted('Controls', { text: '\0\u0001\b\t\n\r\u000e\u001f\u007f\u0080\u00ff\'"-' }),
  ...[63, 64, 8191, 8192].map(length => accepted('Length' + length, { text: 'a'.repeat(length) })),
  accepted('Duplicate', { body(writer, input) { load(writer, input).op('dup').op('pop').op('ret'); } }),
  accepted('StringLocal', { locals: ['string'], body(writer, input) {
    load(writer, input).op('stloc.0').op('ldloc.0').op('ret');
  } }),
  accepted('ObjectLocal', { locals: ['object'], result: 'object', body(writer, input) {
    load(writer, input).op('stloc.0').op('ldloc.0').op('ret');
  } }),
  accepted('StringArgument', { parameters: ['string'], body(writer, input) {
    load(writer, input).op('starg.s', 0).op('ldarg.0').op('ret');
  } }),
  accepted('NullJoin', { parameters: ['bool'], body(writer, input) {
    writer.op('ldarg.0').op('brtrue.s', 'null');
    load(writer, input).op('br.s', 'join');
    writer.mark('null').op('ldnull').mark('join').op('ret');
  } }),
  accepted('ObjectJoin', { parameters: ['object'], result: 'object', body(writer, input) {
    writer.op('ldarg.0').op('brtrue.s', 'object');
    load(writer, input).op('br.s', 'join');
    writer.mark('object').op('ldarg.0').mark('join').op('ret');
  } }),
  accepted('ReferenceEquality', { result: 'int', body(writer, input) {
    load(writer, input);
    load(writer, input).op('ceq').op('ret');
  } }),
  accepted('ReferenceCondition', { result: 'void', body(writer, input) {
    load(writer, input).op('brtrue.s', 'end').op('nop').mark('end').op('ret');
  } }),
  accepted('LiteralLoop', { locals: ['int', 'string'], body(writer, input) {
    load(writer, input).op('stloc.1').mark('loop');
    load(writer, input).op('pop').op('ldloc.0').op('ldc.i4.1').op('add').op('stloc.0');
    writer.op('ldloc.0').op('ldc.i4.3').op('blt.s', 'loop').op('ldloc.1').op('ret');
  } }),
  rejected('NumericReturn', { result: 'int' }),
  rejected('NumericLocal', { locals: ['int'], result: 'void', body(writer, input) {
    load(writer, input).op('stloc.0').op('ret');
  } }),
  rejected('NumericArgument', { parameters: ['int'], result: 'void', body(writer, input) {
    load(writer, input).op('starg.s', 0).op('ret');
  } }),
  rejected('NumericOperation', { result: 'void', diagnostic: 'ExpectedNumericType', body(writer, input) {
    load(writer, input).op('ldc.i4.1').op('add').op('pop').op('ret');
  } }),
  rejected('NarrowObjectJoin', { parameters: ['object'], body(writer, input) {
    writer.op('ldarg.0').op('brtrue.s', 'object');
    load(writer, input).op('br.s', 'join');
    writer.mark('object').op('ldarg.0').mark('join').op('ret');
  } }),
  rejected('VoidReturn', { result: 'void', diagnostic: 'ReturnVoid' }),
  accepted('StaticStringStore', { fields: [textField], result: 'void', metadata: true, body(writer, input) {
    load(writer, input).op('stsfld', input.fields.Text).op('ret');
  } }),
  accepted('StaticObjectStore', { fields: [{ name: 'Text', type: 'object' }], result: 'void', metadata: true,
    body(writer, input) { load(writer, input).op('stsfld', input.fields.Text).op('ret'); } }),
  accepted('InstanceStringStore', { fields: [{ ...textField, static: false }], parameters: ['class Fixture.Program'],
    result: 'void', metadata: true, body(writer, input) {
      writer.op('ldarg.0');
      load(writer, input).op('stfld', input.fields.Text).op('ret');
    } }),
  accepted('FieldBeforeLiteral', { fields: [textField], metadata: true, body(writer, input) {
    writer.op('ldsfld', input.fields.Text).op('pop');
    load(writer, input).op('ret');
  } }),
  rejected('StaticNumericStore', { fields: [{ name: 'Text', type: 'int' }], result: 'void', metadata: true,
    body(writer, input) { load(writer, input).op('stsfld', input.fields.Text).op('ret'); } }),
  { name: 'NominalReturnUnknown', result: 'class Fixture.Program', metadata: true, status: 'unknown', nativeAccepted: false,
    diagnostic: 'PrimitiveNominalRelationUnavailable' },
];
