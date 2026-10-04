import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly, loadProjectAssembly} from '@sharpforge/cil';
import {createProjectAssemblyInspector} from '@sharpforge/runtime';
import {DebugSession, CilDebugSession} from '@sharpforge/debugger';
import {projectApplication, projectLibrary} from './support/project-assembly-fixtures.js';

function graphSources() {
  const source = (name, value) => [{uri: 'Shared.cs', text:
    `public class ${name} {\n public static int Read() {\n return ${value};\n }\n}`}];
  const left = projectLibrary('Left', source('Left', 20));
  const right = projectLibrary('Right', source('Right', 22));
  const app = projectApplication('System.Console.WriteLine(Left.Read() + Right.Read());', [left, right]);
  const dependencies = [{assembly: left.assembly, project: 'Left.csproj', contextId: 'left-net10'},
    {assembly: right.assembly, project: 'Right.csproj', contextId: 'right-net10'}];
  return {app, dependencies};
}

for (const backend of ['source', 'cil']) {
  test(`${backend} stack frames retain original module identity, CLI token and colliding source provenance`, () => {
    const {app, dependencies} = graphSources();
    const graph = loadProjectAssembly(app.assembly, {dependencies});
    const inspector = backend === 'cil' ? createProjectAssemblyInspector(app.assembly, {dependencies}) : null;
    const session = inspector ? new CilDebugSession(inspector, {autoLoadSymbols: false}) : new DebugSession(graph.image);
    const source = graph.image.sources.find(item => item.contextId === 'right-net10');
    assert(source);
    assert.equal(session.setBreakpoints(source.uri, [{line: 3}])[0].verified, true);
    session.start(false);
    const paused = session.runUntilStop();
    assert.equal(paused.state, 'paused');
    const frame = paused.frames.find(item => item.source === source.uri);
    assert(frame);
    assert.equal(frame.assemblyKey, source.assemblyKey);
    assert.equal(frame.originalUri, 'Shared.cs');
    assert.equal(frame.project, 'Right.csproj');
    assert.equal(frame.contextId, 'right-net10');
    assert.equal(frame.originalMethodToken >>> 24, 6);
    assert.equal(frame.line, 3);
    assert.equal(Number.isInteger(frame.ilOffset), true);
    const module = graph.modules.find(item => item.key === frame.assemblyKey);
    assert.equal(module.inspector.getMethod(frame.originalMethodToken).name, 'Read');
    assert.deepEqual(session.stackTrace(session.vm.scheduler.currentId), session.stackTrace());
    session.stop();
  });
}

test('source debugger remains usable with absent or partial optional IL inspection tables', () => {
  const built = compileToIL('class Program { static void Main() {\n System.Console.WriteLine(42);\n } }');
  assert.equal(built.success, true, JSON.stringify(built.diagnostics));
  for (const il of [undefined, {format: 'ECMA-335'}, {methodTokens: [], offsets: []}]) {
    const image = {...loadAssembly(built.assembly), il};
    const session = new DebugSession(image);
    session.start(true);
    const state = session.runUntilStop();
    assert.equal(state.state, 'paused');
    assert(state.frames.length);
    assert.equal(state.frames[0].methodToken, null);
    assert.equal(state.frames[0].ilOffset, null);
    assert.equal('assemblyKey' in state.frames[0], false);
    session.stop();
  }
});
