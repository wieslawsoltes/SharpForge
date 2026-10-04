import {createHash} from 'node:crypto';

/** Fixed workload: changing weights requires a new protocol, not a more favorable retry. */
export const protocol = Object.freeze({
  id: 'studio-instrumentation-overhead-v1', pairs: 12, sourceFiles: 17,
  documentSwitches: 32, commands: 64, inputs: 32,
  tools: Object.freeze(['command-window', 'bookmarks', 'test-explorer']),
  command: 'workbench.bookmark.toggle', key: 'x', budgetPercent: 1
});
export const operations = Object.freeze({
  startup: 1, 'document-switch': protocol.documentSwitches, 'tool-activation': protocol.tools.length,
  command: protocol.commands, 'trusted-key-input': protocol.inputs
});
export const viewport = Object.freeze({width: 1440, height: 1000});

export function workspaceFixture() {
  const records = [{path: 'Overhead.csproj', text: '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
    + '<OutputType>Exe</OutputType></PropertyGroup></Project>'},
  {path: 'Program.cs', text: 'class Program { static void Main() {} }'}];
  for (let index = 0; index < protocol.sourceFiles - 1; index++) {
    records.push({path: `Types/Type${index}.cs`, text: `class Type${index} { public int Value { get; set; } }`});
  }
  return {records, sha256: createHash('sha256').update(JSON.stringify(records)).digest('hex')};
}

export function settingsState(origin, enabled) {
  return {cookies: [], origins: [{origin, localStorage: [{name: 'sharpforge.workbench.settings.v2',
    value: JSON.stringify({version: 2, user: {environment: {
      performanceTracing: enabled, firstRunComplete: true, showStartWindow: false
    }}, workspaces: {}})}]}]};
}

export function pairOrder(index) { return index % 2 === 0 ? [false, true] : [true, false]; }
