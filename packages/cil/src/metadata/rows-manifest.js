import { rowWriterGroup } from './row-writer.js';

/** Manifest row writers preserve full identities and explicit forwarding/resource tokens. */
export function manifestRowWriters(builder) {
  return rowWriterGroup(builder, {
    module: 'Module', assembly: 'Assembly', assemblyRef: 'AssemblyRef', moduleRef: 'ModuleRef',
    file: 'File', exportedType: 'ExportedType', manifestResource: 'ManifestResource',
    assemblyProcessor: 'AssemblyProcessor', assemblyOS: 'AssemblyOS',
    assemblyRefProcessor: 'AssemblyRefProcessor', assemblyRefOS: 'AssemblyRefOS',
  });
}
