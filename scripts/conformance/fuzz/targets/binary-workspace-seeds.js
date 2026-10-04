import { encodeWorkspaceFile, readZip, writeZip } from '@sharpforge/archive';
import { exportWorkspaceZip } from '@sharpforge/project-system';

/** Small local source/text/binary fixtures; import never compiles their contents or starts a project. */
export function workspaceArchiveSeeds() {
  const input = exportWorkspaceZip({
    records: [
      { path: 'Program.cs', text: 'int value = 7;\n' },
      { path: 'Sample.csproj', text: '<Project Sdk="Microsoft.NET.Sdk" />\n' },
      { path: 'Assets/pixel.bin', bytes: new Uint8Array([0, 255, 128, 1]) },
      { path: 'Notes.md', bytes: encodeWorkspaceFile({ path: 'Notes.md', text: 'Żółć\n', encoding: 'utf-16le', bom: true }) },
    ],
    folders: ['Empty'],
    settings: {
      name: 'FuzzWorkspace', mode: 'project', entry: 'Sample.csproj', startup: 'Sample.csproj',
      tabs: ['Program.cs'], active: 'Program.cs', breakpoints: { 'Program.cs': [{ line: 1, enabled: true }] },
    },
  });
  const prefixed = writeZip([
    { path: 'repository', directory: true },
    ...readZip(input).map(entry => ({ ...entry, path: `repository/${entry.path}` })),
  ]);
  return [
    { name: 'workspace-manifest', input },
    { name: 'repository-workspace', input: prefixed },
  ];
}
