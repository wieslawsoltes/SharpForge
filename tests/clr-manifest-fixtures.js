import { createHash } from 'node:crypto';
import { MetadataBuilder, Writer, writePE, codedIndex } from '@sharpforge/cil';
import { AssemblyLoadSession } from '../packages/clr/src/index.js';

const hashNames = Object.freeze({ 0: 'sha1', 0x8003: 'md5', 0x8004: 'sha1', 0x800c: 'sha256', 0x800d: 'sha384', 0x800e: 'sha512' });

/** Small independent metadata/resource fixtures; byte prefixes are authored here, not by the product resource writer. */
export function manifestImage(name = 'ManifestFixture', {
  resources = [], files = [], references = [], hashAlgorithm = 0x800c, netmodule = false, entryPoint = false, decorate,
} = {}) {
  const md = new MetadataBuilder(name, netmodule ? { outputKind: 'netmodule' } : { assemblyVersion: [1, 0, 0, 0] });
  md.add(2, [0, md.string('<Module>'), 0, 0, 1, 1]);
  if (!netmodule) md.rows[32][0][0] = hashAlgorithm;
  const referenceTokens = references.map(reference => md.add(35, [1, 0, 0, 0, 0, 0, md.string(reference), 0, 0]));
  const fileTokens = files.map(file => md.add(38, [file.flags ?? (file.containsMetadata ? 0 : 1), md.string(file.name),
    md.blob(file.hashValue ?? createHash(hashNames[hashAlgorithm] ?? 'sha256').update(file.bytes ?? new Uint8Array()).digest())]));
  const data = new Writer();
  for (const resource of resources) {
    let implementation = 0;
    let offset = resource.offset ?? 0;
    if (resource.reference !== undefined) implementation = referenceTokens[resource.reference];
    else if (resource.file !== undefined) implementation = fileTokens[resource.file];
    else if (resource.bytes) {
      data.pad(8);
      offset = data.length;
      data.u32(resource.bytes.length).bytes(resource.bytes);
    }
    md.add(40, [offset, resource.flags ?? 1, md.string(resource.name),
      resource.implementationRaw ?? (implementation ? codedIndex('Implementation', implementation) : 0)]);
  }
  decorate?.({ md, data });
  const section = new Writer().zero(72);
  const entryToken = entryPoint ? md.add(6, [0x2000 + section.length, 0, 0x0096,
    md.string('Main'), md.blob(Uint8Array.of(0, 0, 1)), 1]) : 0;
  if (entryPoint) section.u8(6).u8(0x2a).pad(4);
  const resourceOffset = section.length;
  section.bytes(data.finish()).pad(4);
  const metadataOffset = section.length;
  const metadata = md.finish(undefined, new TextEncoder().encode(name));
  section.bytes(metadata);
  return writePE(section.finish(), metadataOffset, metadata.length, entryToken,
    { resources: { offset: resourceOffset, size: data.length } });
}

export function manifestContext(images = new Map(), options = {}) {
  return new AssemblyLoadSession().createContext({ name: 'Resources', isCollectible: true,
    load: ({ assemblyName }) => images.get(assemblyName.name) ?? null, ...options });
}

export async function openManifest(image, options = {}) {
  const context = manifestContext();
  const assembly = await context.loadFromStream(image);
  return { context, assembly, reader: assembly.openManifestResources(options) };
}

export const binaryResource = Uint8Array.of(0, 127, 128, 255);

export function manifestForwarders() {
  return new Map([
    ['ResourceFacade', manifestImage('ResourceFacade', { references: ['ResourceBridge'],
      resources: [{ name: 'payload', reference: 0 }, { name: 'absent', reference: 0 }] })],
    ['ResourceBridge', manifestImage('ResourceBridge', { references: ['ResourceTarget'],
      resources: [{ name: 'payload', reference: 0 }, { name: 'absent', reference: 0 }] })],
    ['ResourceTarget', manifestImage('ResourceTarget', { resources: [{ name: 'payload', bytes: binaryResource }] })],
  ]);
}
