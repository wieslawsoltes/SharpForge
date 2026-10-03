import { hex } from './hash.js';
export const PdbGuids = Object.freeze({
  csharp: '3f5162f8-07c6-11d3-9053-00c04fa302a1',
  sha1: 'ff1816ec-aa5e-4d10-87f7-6f4963833460',
  sha256: '8829d00f-11b8-4213-878b-770e8597ac16',
  sha384: 'd99cfeb1-8c43-444a-8a6c-b61269d2a0bf',
  sha512: 'ef2d1afc-6550-46d6-b14b-d70afe9a5566',
  embeddedSource: '0e8a571b-6926-466e-b4ad-8ab04611f5fe',
  sourceLink: 'cc110556-a091-4d38-9fec-25ab9a351a6a',
  asyncSteps: '54fd2ac5-e925-401a-9c2a-f94f171072f8',
  hoistedScopes: '6da9a61e-f8c7-4874-be62-68bc5630df71',
  dynamicLocals: '83c563c4-b4f3-47d5-b824-ba5441477ea8',
  encSlots: '755f52a8-91c5-45be-b4b8-209571e552bd',
  encStates: '8b78cd68-2ede-420b-980b-e15884b8aaa3',
  encLambdas: 'a643004c-0240-496f-a783-30d64f4979de',
  tupleNames: 'ed9fdf71-8879-4747-8ed3-fe5ede3ce710',
  compilationReferences: '7e4d4708-096e-4c5c-aeda-cb10ba6a740d',
  typeDocuments: '932e74bc-dba9-4478-8d46-0f32a7bab3d3',
  primaryConstructor: '9d40ace1-c703-4d0e-bf41-7243060a8fb5',
  defaultNamespace: '58b2eab6-209f-4e4e-a22c-b2d0f910c782',
  compilationOptions: 'b5feec05-8cd0-4a83-96da-466284bb4bd8',
});
export class SymbolError extends Error {
  constructor(message, { code, format } = {}) {
    super(message);
    this.name = 'SymbolError';
    if (code !== undefined) this.code = code;
    if (format !== undefined) this.format = format;
  }
}
export const fail = (message) => {
  throw new SymbolError(message);
};
export const HIDDEN = 0xfeefee;
export function guidBytes(value) {
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value)) fail('Invalid GUID');
  const raw = Uint8Array.from(value.replaceAll('-', '').match(/../g), (s) => parseInt(s, 16));
  return Uint8Array.from([raw[3], raw[2], raw[1], raw[0], raw[5], raw[4], raw[7], raw[6], ...raw.slice(8)]);
}
export function guidString(bytes) {
  if (bytes.length !== 16) fail('Invalid GUID bytes');
  const b = Uint8Array.from([
      bytes[3],
      bytes[2],
      bytes[1],
      bytes[0],
      bytes[5],
      bytes[4],
      bytes[7],
      bytes[6],
      ...bytes.slice(8),
    ]),
    s = hex(b);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
