const owner = 'class Fixture.Owner';
const other = 'class Fixture.Other';
const value = 'valuetype Fixture.Value';
const valueOther = 'valuetype Fixture.OtherValue';
const verified = (name, options = {}) => ({ name, status: 'verified', ...options });
const rejected = (name, diagnostic, options = {}) => ({ name, status: 'rejected', diagnostic, ...options });
const unknown = (name, diagnostic, options = {}) => ({ name, status: 'unknown', diagnostic, nativeAccepted: true, ...options });
const unary = (opcode, type) => (writer, input) => writer.op('ldarg.0').op(opcode, input.types[type]).op('ret');
const construct = (writer, input) => writer.op('newobj', input.constructors.Owner).op('ret');
const annotatedBox = { parameters: [value], result: 'object', body: unary('box', 'Value') };

/** Independent cases fix native expectations before capture; unknown capabilities never count as parity. */
export const objectCases = [
  verified('NewClass', { result: owner, body: construct }),
  verified('NewObjectReturn', { result: 'object', body: construct }),
  verified('NewDerived', { constructor: { owner: 'Derived' }, result: owner,
    body: (writer, input) => writer.op('newobj', input.constructors.Derived).op('ret') }),
  verified('NewArguments', { constructor: { owner: 'Owner', parameters: ['int', 'string'] }, result: owner,
    body(writer, input) {
      writer.op('ldc.i4.1').op('ldstr', 0x70000000 + input.builder.userString('argument'));
      construct(writer, input);
    } }),
  verified('NewValue', { result: value, body: (writer, input) => writer.op('newobj', input.constructors.Value).op('ret') }),
  verified('NewLocalMemberRef', { result: owner, body(writer, input) {
    const token = input.builder.member(input.types.Owner, '.ctor', methodSignature('void', [], false, input.resolve));
    writer.op('newobj', token).op('ret');
  } }),
  rejected('NewWrongArgument', 'StackUnexpected', { constructor: { owner: 'Owner', parameters: ['int'] }, result: owner,
    body(writer, input) { writer.op('ldnull'); construct(writer, input); } }),
  rejected('NewMissingArgument', 'StackUnderflow', { constructor: { owner: 'Owner', parameters: ['int'] }, result: owner, body: construct }),
  rejected('NewReadonlyArgument', 'StackUnexpected', { constructor: { owner: 'Owner', parameters: [value + '&'] },
    parameters: ['object'], result: owner, body(writer, input) {
      writer.op('ldarg.0').op('unbox', input.types.Value);
      construct(writer, input);
    } }),
  rejected('NewWrongReturn', 'StackUnexpected', { result: other, body: construct }),
  rejected('NewOrdinaryMethod', 'CtorExpected', { body: (writer, input) => writer.op('newobj', input.ordinary).op('pop').op('ret') }),
  rejected('NewAbstract', 'NewobjAbstractClass', { body: (writer, input) => writer.op('newobj', input.constructors.Abstract).op('pop').op('ret') }),
  rejected('NewPrivateOutside', 'MethodAccess', { constructor: { owner: 'Owner', flags: 0x1881 }, result: owner, body: construct }),
  verified('NewPrivateInside', { constructor: { owner: 'Owner', flags: 0x1881 }, owner: 'Owner', result: owner, body: construct }),
  unknown('NewExternalBase', 'ConstructorBaseUnavailable', { externalBase: 'System.Exception', result: owner, body: construct }),
  unknown('NewDelegateNumeric', 'ConstructorBaseUnavailable', { externalBase: 'System.MulticastDelegate', nativeAccepted: false,
    constructor: { owner: 'Owner', parameters: ['object', 'nint'] }, body(writer, input) {
      writer.op('ldnull').op('ldc.i4.0').op('conv.i').op('newobj', input.constructors.Owner).op('pop').op('ret');
    } }),
  verified('CastClass', { parameters: ['object'], result: owner, body: unary('castclass', 'Owner') }),
  verified('CastUnrelatedReference', { parameters: [other], result: owner, body: unary('castclass', 'Owner') }),
  verified('CastNull', { result: owner, body: (writer, input) => writer.op('ldnull').op('castclass', input.types.Owner).op('ret') }),
  verified('IsInterface', { parameters: ['object'], result: 'class Fixture.IContract', body: unary('isinst', 'IContract') }),
  verified('CastBoxedValue', { parameters: ['object'], result: 'object', body: unary('castclass', 'Value') }),
  unknown('CastTypeSpecification', 'MetadataUnavailable', { parameters: ['object'], result: owner,
    decorate(input) { input.specification = input.builder.addRow('TypeSpec', { Signature: Uint8Array.of(0x12, 8) }); },
    body: (writer, input) => writer.op('ldarg.0').op('castclass', input.specification).op('ret') }),
  rejected('CastNumeric', 'StackObjRef', { parameters: ['int'], result: owner, body: unary('castclass', 'Owner') }),
  rejected('CastManagedPointer', 'StackObjRef', { parameters: ['int&'], result: owner, body: unary('castclass', 'Owner') }),
  rejected('CastPrivateType', 'TypeAccess', { parameters: ['object'], body(writer, input) {
    writer.op('ldarg.0').op('castclass', input.types.Hidden).op('pop').op('ret');
  } }),
  verified('BoxValue', { ...annotatedBox }),
  verified('BoxInterface', { parameters: [value], result: 'class Fixture.IContract', body: unary('box', 'Value') }),
  verified('BoxReference', { parameters: [owner], result: owner, body: unary('box', 'Owner') }),
  verified('BoxNullReference', { result: owner, body: (writer, input) => writer.op('ldnull').op('box', input.types.Owner).op('ret') }),
  rejected('BoxWrongValue', 'StackUnexpected', { parameters: [valueOther], result: 'object', body: unary('box', 'Value') }),
  rejected('BoxWrongReference', 'StackUnexpected', { parameters: [other], result: owner, body: unary('box', 'Owner') }),
  rejected('BoxAsWrongClass', 'StackUnexpected', { parameters: [value], result: other, body: unary('box', 'Value') }),
  verified('UnboxValue', { parameters: ['object'], result: value, body: unary('unbox.any', 'Value') }),
  verified('UnboxReference', { parameters: ['object'], result: owner, body: unary('unbox.any', 'Owner') }),
  verified('UnboxFieldRead', { parameters: ['object'], result: 'int', body(writer, input) {
    writer.op('ldarg.0').op('unbox', input.types.Value).op('ldfld', input.members['Value.Number']).op('ret');
  } }),
  rejected('UnboxFieldWrite', 'StackUnexpected', { parameters: ['object'], body(writer, input) {
    writer.op('ldarg.0').op('unbox', input.types.Value).op('ldc.i4.1').op('stfld', input.members['Value.Number']).op('ret');
  } }),
  rejected('UnboxReferenceOperand', 'ValueTypeExpected', { parameters: ['object'], body(writer, input) {
    writer.op('ldarg.0').op('unbox', input.types.Owner).op('pop').op('ret');
  } }),
  rejected('UnboxNumericInput', 'StackObjRef', { parameters: ['int'], result: value, body: unary('unbox.any', 'Value') }),
  verified('BoxThenDifferentUnbox', { parameters: [valueOther], result: value, body(writer, input) {
    writer.op('ldarg.0').op('box', input.types.OtherValue).op('unbox.any', input.types.Value).op('ret');
  } }),
  verified('BoxedCondition', { parameters: ['object'], body(writer, input) {
    writer.op('ldarg.0').op('isinst', input.types.Value).op('brtrue.s', 'end').op('nop').mark('end').op('ret');
  } }),
  verified('UnboxPointerCondition', { parameters: ['object'], body(writer, input) {
    writer.op('ldarg.0').op('unbox', input.types.Value).op('brtrue.s', 'end').op('nop').mark('end').op('ret');
  } }),
  verified('UnboxPointerComparison', { parameters: ['object'], result: 'int', body(writer, input) {
    writer.op('ldarg.0').op('unbox', input.types.Value).op('dup').op('ceq').op('ret');
  } }),
  verified('BoxedJoin', { parameters: [value, valueOther, 'bool'], result: 'object', body(writer, input) {
    writer.op('ldarg.2').op('brtrue.s', 'other').op('ldarg.0').op('box', input.types.Value).op('br.s', 'join');
    writer.mark('other').op('ldarg.1').op('box', input.types.OtherValue).mark('join').op('ret');
  } }),
  verified('HarmlessAnnotation', { ...annotatedBox, annotations: [{ kind: 'harmless' }], annotationAuthority: true }),
  rejected('RefLikeBox', 'BoxByRef', { ...annotatedBox, annotations: [{ kind: 'byRefLike' }], annotationAuthority: true,
    nativeAccepted: true,
    difference: 'ILVerify 10.0.5 checks only ByRef stack kinds in IsByRefLike; this profile also rejects authoritative ref-like value types.' }),
  unknown('RefLikeConstruction', 'ByRefLikeLifetimeUnavailable', { annotations: [{ kind: 'byRefLike' }], annotationAuthority: true,
    body: (writer, input) => writer.op('newobj', input.constructors.Value).op('pop').op('ret') }),
  unknown('RefLikeReturn', 'ByRefLikeLifetimeUnavailable', { annotations: [{ kind: 'byRefLike' }], annotationAuthority: true,
    nativeAccepted: false, result: value, body: (writer, input) => writer.op('newobj', input.constructors.Value).op('ret') }),
  unknown('MissingAnnotationAuthority', 'ObjectAnnotationAuthorityUnavailable', { ...annotatedBox, annotations: [{ kind: 'harmless' }] }),
  unknown('CounterfeitNameWithoutAuthority', 'ObjectAnnotationAuthorityUnavailable', {
    ...annotatedBox, annotations: [{ kind: 'counterfeit' }] }),
  verified('CounterfeitKnownHarmless', { ...annotatedBox, annotations: [{ kind: 'counterfeit' }], annotationAuthority: true }),
  unknown('EnumBox', 'EnumStorageUnavailable', { parameters: ['int'], result: 'object', body: unary('box', 'Choice') }),
  unknown('EnumUnbox', 'EnumStorageUnavailable', { parameters: ['object'], result: 'int', body: unary('unbox.any', 'Choice') }),
];
import { methodSignature } from '@sharpforge/cil';
