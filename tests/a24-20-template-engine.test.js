import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTemplateConfig, evaluateTemplateSymbols, instantiateTemplate, evaluateTemplateExpression,
  TemplateCatalog, installTemplatePackage, searchTemplates, createProjectPlan, uninstallTemplatePackage } from '@sharpforge/templates';
import { writeZip } from '@sharpforge/archive';

const config = {
  identity: 'Example.Console', name: 'Console fixture', shortName: ['sample-console'], sourceName: 'ConsoleApplication1',
  symbols: {
    Framework: { type: 'parameter', dataType: 'choice', choices: [{ choice: 'net8.0' }, { choice: 'net9.0' }, { choice: 'net10.0' }],
      defaultValue: 'net10.0', replaces: 'net8.0' },
    UseProgramMain: { type: 'parameter', dataType: 'bool', defaultValue: 'false' },
    Nullable: { type: 'parameter', dataType: 'bool', defaultValue: 'true' },
    WithNamespace: { type: 'computed', value: 'UseProgramMain && Nullable' },
    LowerName: { type: 'derived', valueSource: 'name', valueTransform: 'lowerCase', replaces: 'lower-name' },
    Identifier: { type: 'generated', generator: 'guid' }
  },
  sources: [{ modifiers: [{ condition: '!Nullable', exclude: ['Nullable.txt'] }], copyOnly: ['copy.txt'], rename: { 'old.txt': 'renamed.txt' } }],
  primaryOutputs: [{ path: 'ConsoleApplication1.csproj' }],
  postActions: [{ actionId: '210D431B-A78B-4D2F-B762-4ED3E3EA9025', description: 'Restore ConsoleApplication1' },
    { actionId: 'unsafe-process', args: { executable: 'example.exe' }, manualInstructions: [{ text: 'Inspect and execute manually.' }] }]
};
const files = [
  { path: 'ConsoleApplication1.csproj', text: '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework>' +
    '<OutputType>Exe</OutputType></PropertyGroup></Project>\n' },
  { path: 'Program.cs', text: 'using System;\n//#if (UseProgramMain)\nnamespace ConsoleApplication1;\nclass Program { static void Main() { Console.WriteLine("Hello"); } }\n' +
    '//#else\nConsole.WriteLine("Hello");\n//#endif\n' },
  { path: 'old.txt', text: 'ConsoleApplication1 lower-name\n' },
  { path: 'copy.txt', text: 'ConsoleApplication1 lower-name\n' },
  { path: 'Nullable.txt', text: 'nullable\n' },
  { path: '.template.config/template.json', text: JSON.stringify(config) }
];

test('template.json: typed defaults, symbols, forms, computed dependencies and deterministic generated values', () => {
  const parsed = parseTemplateConfig('// config\n' + JSON.stringify(config));
  assert.equal(parsed.parameters.length, 3);
  const values = evaluateTemplateSymbols(parsed, {}, { name: 'Demo' });
  assert.equal(values.Framework, 'net10.0');
  assert.equal(values.UseProgramMain, false);
  assert.equal(values.LowerName, 'demo');
  assert.equal(values.WithNamespace, false);
  assert.match(values.Identifier, /^[a-f0-9-]{36}$/);
  assert.equal(evaluateTemplateSymbols(parsed, {}, { name: 'Demo' }).Identifier, values.Identifier);
  assert.notEqual(evaluateTemplateSymbols(parsed, {}, { name: 'Other' }).Identifier, values.Identifier);
  assert.throws(() => evaluateTemplateSymbols(parsed, { Framework: 'net500.0' }), /Invalid choice/);
  assert.throws(() => evaluateTemplateSymbols(parsed, { Missing: true }), /Unknown template parameter/);
  assert.throws(() => parseTemplateConfig('{broken'), /Invalid template.json/);
  assert.throws(() => parseTemplateConfig(JSON.stringify(config), { maxBytes: 2 }), /size/);
});

for (const parameters of [{}, { UseProgramMain: true, Framework: 'net9.0' }, { Nullable: false, Framework: 'net8.0' }]) {
  test('Template instantiation applies option combination ' + JSON.stringify(parameters), () => {
    const parsed = parseTemplateConfig(config);
    const plan = instantiateTemplate(parsed, files, { name: 'Demo', parameters });
    assert(plan.records.some(record => record.path === 'Demo.csproj'));
    assert(!plan.records.some(record => record.path.includes('.template.config')));
    assert.equal(plan.records.some(record => record.path === 'Nullable.txt'), parameters.Nullable !== false);
    assert.equal(plan.records.find(record => record.path === 'renamed.txt').text, 'Demo demo\n');
    assert.equal(plan.records.find(record => record.path === 'copy.txt').text, 'ConsoleApplication1 lower-name\n');
    assert.equal(plan.records.find(record => record.path === 'Program.cs').text.includes('class Program'), parameters.UseProgramMain === true);
    assert(plan.postActions.every(action => action.manual));
    assert.deepEqual(instantiateTemplate(parsed, files, { name: 'Demo', parameters }), plan);
  });
}

test('Template conditional comments retain CRLF for XML and JSON branches and reject unmatched controls', () => {
  const source = [
    { path: 'value.xml', text: '<Root>\r\n<!--#if (Nullable)-->\r\n<Value />\r\n<!--#else-->\r\n<Other />\r\n<!--#endif-->\r\n</Root>\r\n' },
    { path: 'value.json', text: '{\n//#if (Nullable)\n"enabled": true\n//#else\n"enabled": false\n//#endif\n}\n' }
  ];
  const plan = instantiateTemplate(config, source, { name: 'Demo' });
  assert.equal(plan.records.find(record => record.path === 'value.xml').text, '<Root>\r\n<Value />\r\n</Root>\r\n');
  assert.equal(JSON.parse(plan.records.find(record => record.path === 'value.json').text).enabled, true);
  assert.throws(() => instantiateTemplate(config, [{ path: 'bad.cs', text: '#if Nullable\ntext\n' }]), /Unclosed/);
  assert.throws(() => instantiateTemplate(config, files, { name: '../escape' }));
  assert.throws(() => evaluateTemplateExpression('name.constructor()', () => 'x'), /expression/);
  const cycle = structuredClone(config);
  cycle.symbols.Loop = { type: 'computed', value: 'Loop' };
  assert.throws(() => evaluateTemplateSymbols(parseTemplateConfig(cycle)), /cycle/);
});

test('Template package installation is catalog-local, validates every template and exposes only manual post-actions', () => {
  const bytes = writeZip(files.map(file => ({ ...file, path: 'content/' + file.path })));
  const catalog = new TemplateCatalog();
  const installed = installTemplatePackage(bytes, { catalog });
  assert.equal(installed.templates.length, 1);
  assert.equal(searchTemplates({ catalog, query: 'sample-console' }).length, 1);
  assert.equal(searchTemplates({ query: 'sample-console' }).length, 0);
  const plan = createProjectPlan(config.identity, { catalog, projectName: 'Example', parameters: { UseProgramMain: true } });
  assert(plan.records.some(record => record.path === 'Example/Example.csproj'));
  assert(installed.postActions.every(action => action.manual));
  assert.equal(plan.postActions.length, 2);
  assert(plan.postActions.every(action => action.manual));
  assert.deepEqual(plan.primaryOutputs, ['Example/Example.csproj']);
  assert.throws(() => installTemplatePackage(bytes, { catalog }), /already installed/);
  assert.equal(uninstallTemplatePackage(catalog, installed.package.id).length, 1);
  assert.equal(searchTemplates({ catalog, query: 'sample-console' }).length, 0);
  assert.throws(() => installTemplatePackage(writeZip([{ path: 'not-template.txt', text: 'data' }])), /no .template/);
  const cancelled = new AbortController();
  cancelled.abort();
  assert.throws(() => instantiateTemplate(config, files, { signal: cancelled.signal }), { name: 'AbortError' });
});

test('SDK aliases, host bindings, boolean-string conditions and MSBuild template attributes are evaluated before replacement', () => {
  const sdk = { identity: 'SdkShape', shortName: 'sdk-shape', sourceName: 'Old.Name', tags: { language: 'C#' }, symbols: {
    HostIdentifier: { type: 'bind', binding: 'host:HostIdentifier' },
    Enabled: { type: 'parameter', datatype: 'bool', defaultValue: 'true' },
    Version: { type: 'parameter', datatype: 'choice', defaultValue: '10', choices: [{ choice: '8' }, { choice: '10' }] },
    Modern: { type: 'generated', generator: 'regexMatch', parameters: { source: 'Version', pattern: '^(9|10)$' } },
    UseFeature: { type: 'computed', value: 'Modern == "true" && Enabled' }
  } };
  const source = '<Project>\r\n  <PropertyGroup>\r\n' +
    '    <Nullable Condition="\'$(UseFeature)\' == \'true\'">enable</Nullable>\r\n' +
    '    <Old Condition="\'$(UseFeature)\' != \'true\'">disabled</Old>\r\n' +
    '    <RootNamespace Condition="\'$(name)\' != \'$(name{-VALUE-FORMS-}safe_namespace)\'">Old.Name</RootNamespace>\r\n' +
    '    <Runtime Condition="\'$(Configuration)\' == \'Debug\'">untouched</Runtime>\r\n' +
    '  </PropertyGroup>\r\n</Project>\r\n';
  const plan = instantiateTemplate(sdk, [{ path: 'Old.Name.csproj', text: source }], { name: 'New-Name' });
  assert.equal(plan.values.UseFeature, true);
  assert.equal(plan.values.HostIdentifier, 'dotnetcli');
  assert.match(plan.records[0].text, /<Nullable>enable<\/Nullable>/);
  assert.doesNotMatch(plan.records[0].text, /<Old/);
  assert.match(plan.records[0].text, /<RootNamespace>New_Name<\/RootNamespace>/);
  assert.match(plan.records[0].text, /Condition="'\$\(Configuration\)' == 'Debug'"/);
  assert.equal(plan.records[0].path, 'New-Name.csproj');
  assert.throws(() => instantiateTemplate(sdk, [], { parameters: { Version: '20' } }), /Invalid choice/);
  assert.throws(() => parseTemplateConfig({ ...sdk, customOperations: [] }), /Unsupported template operation/);
});

test('Template regex generators reject backtracking patterns and preserve explicit name parameters', () => {
  const source = { identity: 'BoundedRegex', shortName: 'regex', symbols: {
    name: { type: 'parameter', dataType: 'string' },
    Generated: { type: 'generated', generator: 'regexMatch', parameters: { source: 'name', pattern: 'a*a*a*a*b' } }
  } };
  assert.throws(() => evaluateTemplateSymbols(parseTemplateConfig(source), {}, { name: 'aaaa' }), /unbounded/);
  source.symbols.Generated.parameters.pattern = '^[a-z]+$';
  const values = evaluateTemplateSymbols(parseTemplateConfig(source), { name: 'actual' }, { name: 'ignored' });
  assert.equal(values.name, 'actual');
  assert.equal(values.Generated, true);
});
