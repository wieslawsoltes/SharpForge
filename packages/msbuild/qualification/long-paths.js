import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const xml = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

/** Exercise long project/output names and native diagnostic paths without relying on a simulator. */
export async function qualifyLongPaths(engine) {
  const relative = Array.from({ length: 12 }, (_, index) => 'long-path-segment-' + index + '-value').join('/');
  const directory = join(engine.workspace.root, relative);
  await mkdir(directory, { recursive: true });
  const output = join(directory, 'result.txt');
  await writeFile(join(directory, 'Long.proj'), '<Project><Target Name="Build"><WriteLinesToFile File="' + xml(output) +
    '" Lines="qualified" Overwrite="true" /></Target><Target Name="Fail"><Error Code="SFQA1002" Text="Expected path diagnostic"' +
    ' File="' + xml(join(directory, 'Source.cs')) + '" LineNumber="3" ColumnNumber="7" /></Target></Project>');
  const project = relative + '/Long.proj';
  const success = await engine.wait((await engine.start({ project, trusted: true })).id);
  if (success.status !== 'succeeded' || (await readFile(output, 'utf8')).trim() !== 'qualified') throw new Error('Native long-path output failed');
  const failure = await engine.wait((await engine.start({ project, action: 'target', targets: ['Fail'], trusted: true })).id);
  const diagnostic = failure.diagnostics.find(item => item.code === 'SFQA1002');
  if (failure.status !== 'failed' || diagnostic?.workspacePath !== relative + '/Source.cs') {
    throw new Error('Native long-path diagnostic did not resolve to the workspace: ' + JSON.stringify(failure.diagnostics));
  }
  return { capability: 'long-paths-and-diagnostics', status: 'passed', projectCharacters: join(directory, 'Long.proj').length,
    invocation: success.invocation, diagnostic, platform: process.platform };
}
