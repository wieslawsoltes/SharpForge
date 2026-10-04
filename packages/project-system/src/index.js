export {isSourceSnapshot, cloneWorkspaceRecord, recordSource, isTextRecord} from './workspace-records.js';
export * from './legacy-solution.js';
import { xmlEscape } from './xml.js';
export * from './xml.js';
export * from './disk.js';

import { normalizePath } from './paths.js';
export * from './paths.js';
export { matchesGlob, WorkspacePathIndex } from './evaluation/path-index.js';
export * from './build-plan.js';
export * from './build-contexts.js';
export * from './tfm.js';
export * from './rid.js';
export * from './output-layout.js';
export * from './resources.js';
export * from './launch-settings.js';
export * from './configuration-json.js';
export * from './context-selection.js';
export { expandExpression } from './evaluation/expander.js';
export { getCaseInsensitive } from './evaluation/errors.js';
export { projectCompilationOptions } from './evaluation/compiler-options.js';
export { classifyTask, createTargetGraph } from './evaluation/targets.js';
export { runPortableTargets } from './evaluation/target-runner.js';

export { evaluateCondition } from './conditions.js';
export { ProjectSystem } from './project-system.js';

export function createCsproj({assemblyName='Application',targetFramework='net10.0',outputType='Exe',files=[]}={}){
  return `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <OutputType>${xmlEscape(outputType)}</OutputType>\n    <TargetFramework>${xmlEscape(targetFramework)}</TargetFramework>\n    <AssemblyName>${xmlEscape(assemblyName)}</AssemblyName>\n${files.length?'    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>\n':''}  </PropertyGroup>\n${files.length?'  <ItemGroup>\n'+files.map(f=>`    <Compile Include="${xmlEscape(normalizePath(f))}" />`).join('\n')+'\n  </ItemGroup>\n':''}</Project>\n`;
}
export function createSlnx(projects){return `<Solution>\n${projects.map(path=>`  <Project Path="${xmlEscape(normalizePath(path))}" />`).join('\n')}\n</Solution>\n`;}
export * from './explorer.js';
export * from './archive.js';
export * from './archive-stream.js';
export * from './project-edit/index.js';

export {decodeWorkspaceFile,encodeWorkspaceFile} from '@sharpforge/archive';


export {importWorkspaceRecords,workspaceManifestRecord} from './archive.js';
