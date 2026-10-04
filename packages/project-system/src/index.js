export {isSourceSnapshot, cloneWorkspaceRecord, recordSource, isTextRecord} from './workspace-records.js';
export * from './legacy-solution.js';
import { xmlEscape } from './xml.js';
export * from './xml.js';
export * from './disk.js';

import { normalizePath } from './paths.js';
export * from './paths.js';

export { evaluateCondition } from './conditions.js';

export { ProjectSystem } from './project-system.js';

export function createCsproj({assemblyName='Application',targetFramework='net10.0',outputType='Exe',files=[]}={}){
  return `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <OutputType>${xmlEscape(outputType)}</OutputType>\n    <TargetFramework>${xmlEscape(targetFramework)}</TargetFramework>\n    <AssemblyName>${xmlEscape(assemblyName)}</AssemblyName>\n${files.length?'    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>\n':''}  </PropertyGroup>\n${files.length?'  <ItemGroup>\n'+files.map(f=>`    <Compile Include="${xmlEscape(normalizePath(f))}" />`).join('\n')+'\n  </ItemGroup>\n':''}</Project>\n`;
}
export function createSlnx(projects){return `<Solution>\n${projects.map(path=>`  <Project Path="${xmlEscape(normalizePath(path))}" />`).join('\n')}\n</Solution>\n`;}
export * from './project-edit-exports.js';
export * from './archive.js';
export * from './archive-stream.js';

export {decodeWorkspaceFile,encodeWorkspaceFile} from '@sharpforge/archive';

export * from './configuration-exports.js';
