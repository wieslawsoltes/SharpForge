import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, noErrors } from './helpers/project-evaluation.js';
import { ProjectSystem } from '../packages/project-system/src/index.js';

test('portable target graph retains dependencies, hooks, incremental declarations and initial/default targets', () => {
  const result = evaluate(`<Project InitialTargets="Init" DefaultTargets="Build">
    <Target Name="Init"><Message Text="init"/></Target>
    <Target Name="Prepare"><Message Text="prepare"/></Target>
    <Target Name="Before" BeforeTargets="Build"><Message Text="before"/></Target>
    <Target Name="Build" DependsOnTargets="Prepare" Inputs="input" Outputs="output"><Message Text="build"/></Target>
    <Target Name="After" AfterTargets="Build"><Message Text="after"/></Target>
  </Project>`);
  noErrors(result);
  assert.deepEqual(result.project.targetGraph.order, ['Init', 'Prepare', 'Before', 'Build', 'After']);
  assert.equal(result.project.targetGraph.targets.find(target => target.name === 'Build').inputs, 'input');
  const run = result.system.runTargets();
  assert.equal(run.success, true, JSON.stringify(run.diagnostics));
  assert.deepEqual(run.messages.map(message => message.text), ['init', 'prepare', 'before', 'build', 'after']);
});

test('target policy blocks each native-only task by name while allowing portable tasks', () => {
  for (const name of ['Exec', 'Csc', 'MyCustomTask']) {
    const result = evaluate(`<Project><Target Name="Build"><${name}/></Target></Project>`);
    assert(result.diagnostics.some(diagnostic => diagnostic.code === 'SFP1004' && diagnostic.message.includes(name)));
    const run = result.system.runTargets();
    assert.equal(run.success, false);
  }
});

test('target execution writes generated source, adds Compile and makes it available to the build plan', () => {
  const result = evaluate(`<Project Sdk="Microsoft.NET.Sdk" DefaultTargets="Generate">
    <Target Name="Generate">
      <WriteLinesToFile File="obj/Generated.cs" Lines="class Generated { }" Overwrite="true"/>
      <ItemGroup><Compile Include="obj/Generated.cs"/></ItemGroup>
    </Target>
  </Project>`);
  noErrors(result);
  const run = result.system.runTargets();
  assert.equal(run.success, true, JSON.stringify(run.diagnostics));
  assert.deepEqual(run.changedFiles, ['App/obj/Generated.cs']);
  assert.equal(result.system.files.get('App/obj/Generated.cs').text, 'class Generated { }\n');
  const unit = result.system.buildPlan().units[0];
  assert(unit.sources.some(source => source.uri === 'App/obj/Generated.cs' && source.text.includes('class Generated')));
});

test('portable tasks honor Condition and do not mutate a workspace when apply=false', () => {
  const result = evaluate(`<Project DefaultTargets="Build"><Target Name="Build">
    <WriteLinesToFile File="new.txt" Lines="content" Overwrite="true"/>
    <WriteLinesToFile File="skipped.txt" Lines="skip" Condition="false"/>
  </Target></Project>`);
  const run = result.system.runTargets(undefined, undefined, { apply: false });
  assert.equal(run.success, true);
  assert.equal(run.applied, false);
  assert.equal(result.system.files.has('App/new.txt'), false);
  assert.equal(run.files.find(file => file.path === 'App/new.txt').text, 'content\n');
  assert(!run.files.some(file => file.path === 'App/skipped.txt'));
});

test('Copy outputs, in-target properties/items, read lines and directory existence work together', () => {
  const result = evaluate(`<Project DefaultTargets="Build"><Target Name="Build">
    <MakeDir Directories="out"/>
    <Copy SourceFiles="input.txt" DestinationFolder="out" Condition="Exists('out')">
      <Output TaskParameter="CopiedFiles" ItemName="Copied"/>
    </Copy>
    <ReadLinesFromFile File="out/input.txt"><Output TaskParameter="Lines" PropertyName="ReadText"/></ReadLinesFromFile>
    <PropertyGroup><Result>$(ReadText)-done</Result></PropertyGroup>
    <Touch Files="out/touched.txt" AlwaysCreate="true"/>
    <Message Text="$(Result)"/>
  </Target></Project>`, { 'App/input.txt': 'hello\n' });
  noErrors(result);
  const run = result.system.runTargets();
  assert.equal(run.success, true, JSON.stringify(run.diagnostics));
  assert.equal(run.project.properties.result, 'hello-done');
  assert.deepEqual(run.project.evaluatedItems.Copied.map(item => item.identity), ['App/out/input.txt']);
  assert(run.files.some(file => file.path === 'App/out/touched.txt'));
});

test('task metadata batching groups values and exposes each item bucket', () => {
  const result = evaluate(`<Project DefaultTargets="Build"><ItemGroup>
    <Input Include="one"><Group>A</Group></Input><Input Include="two"><Group>A</Group></Input>
    <Input Include="three"><Group>B</Group></Input>
  </ItemGroup><Target Name="Build"><Message Text="%(Input.Group):@(Input, ',')"/></Target></Project>`);
  noErrors(result);
  const run = result.system.runTargets();
  assert.equal(run.success, true, JSON.stringify(run.diagnostics));
  assert.deepEqual(run.messages.map(message => message.text), ['A:one,two', 'B:three']);
});

test('target batching writes one output per metadata bucket', () => {
  const result = evaluate(`<Project DefaultTargets="Build"><ItemGroup><Input Include="one;two"/></ItemGroup>
    <Target Name="Build" Outputs="%(Input.Identity).txt">
      <WriteLinesToFile File="%(Input.Identity).txt" Lines="@(Input)" Overwrite="true"/>
    </Target></Project>`);
  noErrors(result);
  const run = result.system.runTargets();
  assert.equal(run.success, true, JSON.stringify(run.diagnostics));
  assert.deepEqual(run.changedFiles, ['App/one.txt', 'App/two.txt']);
  assert.equal(run.files.find(file => file.path === 'App/one.txt').text, 'one\n');
});

test('ContinueOnError obeys warning/continuation semantics and default failure rolls back virtual changes', () => {
  const warning = evaluate(`<Project DefaultTargets="Build"><Target Name="Build">
    <Error Text="recoverable" ContinueOnError="WarnAndContinue"/><Message Text="continued"/>
  </Target></Project>`).system.runTargets();
  assert.equal(warning.success, true);
  assert.equal(warning.diagnostics[0].severity, 'warning');
  assert.equal(warning.messages[0].text, 'continued');
  const result = evaluate(`<Project DefaultTargets="Build"><Target Name="Build">
    <WriteLinesToFile File="temporary" Lines="x"/><Error Text="failure"/>
  </Target></Project>`);
  const failed = result.system.runTargets();
  assert.equal(failed.success, false);
  assert.equal(result.system.files.has('App/temporary'), false);
  const continuing = evaluate(`<Project DefaultTargets="Build"><Target Name="Build">
    <Error Text="failure" ContinueOnError="ErrorAndContinue"/><Message Text="continued"/>
  </Target></Project>`).system.runTargets();
  assert.equal(continuing.success, false);
  assert.equal(continuing.messages[0].text, 'continued');
});

test('CallTarget executes a target at most once and rejects recursive invocation', () => {
  const result = evaluate(`<Project DefaultTargets="Build"><Target Name="Other"><Message Text="other"/></Target>
    <Target Name="Build"><CallTarget Targets="Other;Other"/></Target></Project>`);
  const run = result.system.runTargets();
  assert.equal(run.success, true);
  assert.deepEqual(run.messages.map(message => message.text), ['other']);
  const cyclic = evaluate('<Project DefaultTargets="A"><Target Name="A"><CallTarget Targets="A"/></Target></Project>');
  assert.equal(cyclic.system.runTargets().success, false);
});

test('Delete and RemoveDir update virtual existence without host file access', () => {
  const result = evaluate(`<Project DefaultTargets="Build"><Target Name="Build">
    <Delete Files="delete.txt"/><RemoveDir Directories="out"/>
    <Message Text="unexpected" Condition="Exists('delete.txt') Or Exists('out')"/>
  </Target></Project>`, { 'App/delete.txt': 'x', 'App/out/old.txt': 'y' });
  const run = result.system.runTargets();
  assert.equal(run.success, true);
  assert.deepEqual(run.messages, []);
  assert(!run.files.some(file => file.path === 'App/delete.txt' || file.path === 'App/out/old.txt'));
});

test('portable target execution enforces steps, output bytes and cancellation', () => {
  const result = evaluate('<Project DefaultTargets="Build"><Target Name="Build"><WriteLinesToFile File="file" Lines="12345"/></Target></Project>');
  assert.equal(result.system.runTargets(undefined, undefined, { maxOutputBytes: 2 }).success, false);
  const budget = result.system.runTargets(undefined, undefined, { maxSteps: 2 });
  assert.equal(budget.success, false);
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => result.system.runTargets(undefined, undefined, { signal: controller.signal }), /cancelled/);
});

test('portable file tasks preserve escaped semicolons in path lists', () => {
  const result = evaluate('<Project><Target Name="Copy"><Copy SourceFiles="a%3Bb.txt" DestinationFiles="out/c%3Bd.txt"/></Target></Project>', {
    'App/a;b.txt': 'contents',
  });
  const run = result.system.runTargets('App/App.csproj', 'Copy');
  assert.equal(run.success, true, JSON.stringify(run.diagnostics));
  assert.equal(result.system.files.get('App/out/c;d.txt').text, 'contents');
});

test('lazy task inputs are an atomic hydration request and can be retried after materialization', () => {
  const tasks = [
    '<ReadLinesFromFile File="input.txt"/>',
    '<Copy SourceFiles="input.txt" DestinationFiles="copy.txt" ContinueOnError="WarnAndContinue"/>',
    '<WriteLinesToFile File="input.txt" Lines="next" Overwrite="false"/>',
  ];
  for (const task of tasks) {
    const system = new ProjectSystem([
      { path: 'App.csproj', text: '<Project><Target Name="Run"><WriteLinesToFile File="early.txt" Lines="start"/>' + task + '</Target></Project>' },
      { path: 'input.txt', size: 7, lazy: true },
    ]);
    system.load('App.csproj');
    const first = system.runTargets('App.csproj', 'Run');
    assert.equal(first.success, false);
    assert.equal(first.applied, false);
    assert.deepEqual(first.requiredFiles, ['input.txt']);
    assert.equal(system.files.has('early.txt'), false);
    assert.equal(system.files.get('input.txt').text, undefined);
    system.files.set('input.txt', { path: 'input.txt', text: 'before\n' });
    const second = system.runTargets('App.csproj', 'Run');
    assert.equal(second.success, true, JSON.stringify(second.diagnostics));
    assert.deepEqual(second.requiredFiles, []);
    if (task.includes('Overwrite="false"')) assert.equal(system.files.get('input.txt').text, 'before\nnext\n');
  }
});
