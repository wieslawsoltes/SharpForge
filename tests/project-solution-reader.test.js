import test from 'node:test';
import assert from 'node:assert/strict';
import { readLegacySolution, convertLegacySolution, parseXml } from '../packages/project-system/src/index.js';

const header = 'Microsoft Visual Studio Solution File, Format Version 12.00\n';
const folderType = '2150E333-8FDC-42A3-9474-1A3956D46DE8';
const projectType = 'FAE04EC0-301F-11D3-BF4B-00C04F79EFBC';
const guid = number => '00000000-0000-0000-0000-' + String(number).padStart(12, '0');
const project = (number, name, path, type = projectType, section = '') =>
  `Project("{${type}}") = "${name}", "${path}", "{${guid(number)}}"\n${section}EndProject\n`;

test('B05 mixed classic solutions retain native-only projects with names, reasons and original IDs', () => {
  const text = header + project(1, 'CSharp', 'CSharp/App.csproj')
    + project(2, 'Native', 'Native/Native.vcxproj') + project(3, 'FSharp', 'FSharp/Library.fsproj');
  const model = readLegacySolution(text, 'Workspace.sln');
  assert.equal(model.name, 'Workspace');
  assert.deepEqual(model.projectPaths, ['CSharp/App.csproj']);
  assert.equal(model.projects.length, 3);
  assert.equal(model.projects[0].supported, true);
  for (const entry of model.projects.slice(1)) {
    assert.equal(entry.supported, false);
    assert.equal(entry.unloaded, true);
    assert.match(entry.reason, /native toolchain/);
    assert.equal(model.items.find(item => item.path === entry.path).id, entry.id);
  }
  assert.equal(model.diagnostics.length, 2);
  assert(model.diagnostics.every(diagnostic => diagnostic.code === 'SFP1301' && diagnostic.severity === 'warning'));
});

test('solution folders, items, dependency IDs and configuration sections retain data', () => {
  const itemSection = 'ProjectSection(SolutionItems) = preProject\nreadme.md = readme.md\nEndProjectSection\n';
  const dependencies = `ProjectSection(ProjectDependencies) = postProject\n{${guid(2)}} = {${guid(2)}}\nEndProjectSection\n`;
  const text = header + project(1, 'Folder', 'Folder', folderType, itemSection)
    + project(2, 'Library', 'Library/Library.csproj') + project(3, 'App', 'App/App.csproj', projectType, dependencies)
    + `Global\nGlobalSection(NestedProjects) = preSolution\n{${guid(3)}} = {${guid(1)}}\nEndGlobalSection\n`
    + 'GlobalSection(SolutionConfigurationPlatforms) = preSolution\nDebug|Any CPU = Debug|Any CPU\nEndGlobalSection\nEndGlobal\n';
  const model = readLegacySolution(text, 'src/Workspace.sln');
  assert.deepEqual(model.folders, ['/Folder/']);
  assert.equal(model.items.find(item => item.kind === 'file').path, 'src/readme.md');
  assert.equal(model.projects.find(entry => entry.name === 'App').folder, '/Folder/');
  assert.deepEqual(model.projects.find(entry => entry.name === 'App').dependencies, [guid(2)]);
  assert.equal(model.folderRecords[0].id, guid(1));
  assert.equal(model.globalSections[1].name, 'SolutionConfigurationPlatforms');
  assert.deepEqual(model.globalSections[1].lines, ['Debug|Any CPU = Debug|Any CPU']);
});

test('conversion retains mixed project membership and warns that configuration mappings stay in the original', () => {
  const text = header + project(1, 'App', 'App/App.csproj') + project(2, 'Native', 'Native/Native.vcxproj');
  const result = convertLegacySolution(text, 'Workspace.sln', 'converted/Workspace.slnx');
  assert.equal(result.path, 'converted/Workspace.slnx');
  assert.deepEqual(parseXml(result.text).children.map(child => child.attributes.Path), [
    '../App/App.csproj', '../Native/Native.vcxproj',
  ]);
  assert.match(result.warnings[0], /configuration mappings.*not converted/);
  assert(result.warnings.some(warning => warning.includes('Native.vcxproj')));
  assert(text.startsWith(header));
});

test('invalid identity graphs, unsafe paths and incomplete sections fail without partial models', () => {
  assert.throws(() => readLegacySolution(header + project(1, 'A', 'A.csproj') + project(1, 'B', 'B.csproj'), 'App.sln'), /Duplicate/);
  assert.throws(() => readLegacySolution(header + project(1, 'A', '../A.csproj'), 'App.sln'), /Unsafe/);
  assert.throws(() => readLegacySolution(header + project(1, 'A', 'A.csproj').replace('EndProject\n', ''), 'App.sln'), /Unterminated/);
  const cycle = header + project(1, 'Folder', 'Folder', folderType)
    + `Global\nGlobalSection(NestedProjects) = preSolution\n{${guid(1)}} = {${guid(1)}}\nEndGlobalSection\nEndGlobal\n`;
  assert.throws(() => readLegacySolution(cycle, 'App.sln'), /cycle/);
  assert.throws(() => readLegacySolution(header + 'ProjectSection(Unknown) = preProject\n', 'App.sln'), /outside a project/);
  assert.throws(() => readLegacySolution('x'.repeat(4 * 1024 * 1024 + 1), 'App.sln'), /Not a supported/);
});
