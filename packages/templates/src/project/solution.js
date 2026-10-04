import { relativeTo } from '@sharpforge/project-system';
import { directoryName } from '../common.js';

function guid(value) {
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (const character of value) for (let index = 0; index < hashes.length; index++) {
    hashes[index] = Math.imul(hashes[index] ^ character.charCodeAt(0), 16777619) >>> 0;
  }
  const hex = hashes.map(hash => hash.toString(16).padStart(8, '0')).join('').toUpperCase();
  return '{' + [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-') + '}';
}

/** Deterministic classic solution with Debug/Release project configurations. */
export function classicSolution(solutionPath, projects) {
  const entries = projects.map(path => ({ path: relativeTo(path, directoryName(solutionPath)).replaceAll('/', '\\'),
    name: path.split('/').at(-1).replace(/\.csproj$/, ''), id: guid(path) }));
  const lines = ['Microsoft Visual Studio Solution File, Format Version 12.00', '# Visual Studio Version 17',
    'VisualStudioVersion = 17.0.31903.59', 'MinimumVisualStudioVersion = 10.0.40219.1'];
  for (const entry of entries) lines.push(`Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "${entry.name}", "${entry.path}", "${entry.id}"`, 'EndProject');
  lines.push('Global', '\tGlobalSection(SolutionConfigurationPlatforms) = preSolution',
    '\t\tDebug|Any CPU = Debug|Any CPU', '\t\tRelease|Any CPU = Release|Any CPU', '\tEndGlobalSection',
    '\tGlobalSection(ProjectConfigurationPlatforms) = postSolution');
  for (const entry of entries) for (const configuration of ['Debug', 'Release']) {
    lines.push(`\t\t${entry.id}.${configuration}|Any CPU.ActiveCfg = ${configuration}|Any CPU`,
      `\t\t${entry.id}.${configuration}|Any CPU.Build.0 = ${configuration}|Any CPU`);
  }
  return [...lines, '\tEndGlobalSection', 'EndGlobal', ''].join('\r\n');
}
