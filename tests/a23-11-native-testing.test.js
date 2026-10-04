import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTrx, parseTestDuration} from '../packages/msbuild/src/testing/trx.js';
import {parseCobertura} from '../packages/msbuild/src/testing/coverage.js';
import {createTestRunArguments, testSelectionFilter} from '../packages/msbuild/src/testing/run.js';
import {TestRunSession} from '../packages/msbuild/src/testing/session.js';
import {mapTestSource} from '../packages/msbuild/src/testing/source-map.js';
import {createTestCase} from '../packages/msbuild/src/testing/model.js';

const trx = String.raw`<TestRun id="run" xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
<TestDefinitions><UnitTest id="pass" name="Pass"><TestMethod className="Fixture.Tests" name="Pass"/></UnitTest>
<UnitTest id="fail" name="Fail"><TestMethod className="Fixture.Tests" name="Fail"/></UnitTest>
<UnitTest id="skip" name="Skip"><TestMethod className="Fixture.Tests" name="Skip"/></UnitTest></TestDefinitions>
<Results><UnitTestResult testId="pass" testName="Pass" outcome="Passed" duration="00:00:00.0123456"/>
<UnitTestResult testId="fail" testName="Fail" outcome="Failed" duration="00:00:01.0000000"><Output>
<ErrorInfo><Message>Assert failed &lt;1&gt;</Message><StackTrace>at Fixture.Tests.Fail() in C:\repo\Tests.cs:line 42</StackTrace></ErrorInfo>
<StdOut>test output</StdOut><StdErr>stderr</StdErr></Output><ResultFiles><ResultFile path="screen.png"/></ResultFiles></UnitTestResult>
<UnitTestResult testId="skip" testName="Skip" outcome="NotExecuted"/></Results><ResultSummary outcome="Failed">
<Counters total="3" passed="1" failed="1" notExecuted="1"/></ResultSummary></TestRun>`;

test('A23 T11 TRX parses actual per-test outcomes, durations, output and attachment records', () => {
  const result = parseTrx(trx, {project: 'Tests.csproj'});
  assert.deepEqual(result.results.map(value => value.outcome), ['passed', 'failed', 'skipped']);
  assert.equal(result.results[0].durationMs, 12.3456);
  assert.equal(result.results[1].message, 'Assert failed <1>');
  assert.equal(result.results[1].stdout, 'test output');
  assert.equal(result.results[1].stderr, 'stderr');
  assert.equal(result.results[1].attachments[0].path, 'screen.png');
  assert.equal(result.tests[1].fqn, 'Fixture.Tests.Fail');
  assert.equal(result.counters.total, 3);
  const location = mapTestSource(result.tests[1], {stackTrace: result.results[1].stackTrace, workspaceRoot: 'C:/repo'});
  assert.deepEqual(location, {path: 'Tests.cs', line: 42, column: 1, origin: 'stack'});
});

test('A23 T11 TRX rejects malformed documents, excessive results and unknown outcome success assumptions', () => {
  assert.throws(() => parseTrx('<Other/>', {project: 'A.csproj'}), /TestRun/);
  assert.throws(() => parseTrx(trx, {project: 'A.csproj', maxTests: 1}), /limit/);
  assert.throws(() => parseTestDuration('00:61:00'), /duration/);
  assert.equal(parseTestDuration('1.01:02:03.5'), 90123500);
  assert.equal(parseTrx(trx.replace('outcome="Passed"', 'outcome="Unknown"'), {project: 'A.csproj'}).results[0].outcome, 'not-runnable');
});

test('A23 T11 filter arguments stay atomic and MTP has explicit TRX capability requirements', () => {
  const filter = testSelectionFilter([{fqn: 'Fixture.Test(A|B)'}]);
  assert.equal(filter, 'FullyQualifiedName=Fixture.Test\\(A\\|B\\)');
  const args = createTestRunArguments({project: 'Tests.csproj', tests: [{fqn: 'Fixture.Tests.Pass'}]}, '/reports');
  assert.equal(args[args.indexOf('--filter') + 1], 'FullyQualifiedName=Fixture.Tests.Pass');
  assert(args.includes('trx;LogFileName=results.trx'));
  assert.throws(() => createTestRunArguments({project: 'Tests.csproj', runner: 'mtp', tests: [{fqn: 'A'}]}, '/reports'), /UID/);
});

test('A23 T11 cancellation leaves remaining tests not-run, bounds progress and reports debugger PID', () => {
  const cases = ['A', 'B'].map(name => createTestCase({project: 'Tests.csproj', fqn: 'Tests.' + name}));
  const session = new TestRunSession({id: 'run', tests: cases, maxEvents: 3});
  session.start();
  session.line({stream: 'stdout', text: 'Process Id: 12345'});
  session.line({stream: 'stdout', text: 'Passed Tests.A [3 ms]'});
  session.cancel();
  const result = session.complete([]);
  assert.equal(result.state, 'cancelled');
  assert.equal(result.debuggerHandoff.pid, 12345);
  assert.equal(result.results.length, 2);
  assert(result.results.every(value => value.outcome === 'not-run'));
  assert.equal(result.events.length, 3);
  assert.equal(result.truncated, true);
  session.dispose();
  assert.equal(session.state, 'disposed');
});

test('A23 T11 Cobertura retains covered/uncovered lines, branch counts and diagnostics for outside-workspace files', () => {
  const source = '<coverage><packages><package><classes><class filename="C:\\repo\\A.cs"><lines>' +
    '<line number="1" hits="2"/><line number="2" hits="0" branch="true" condition-coverage="50% (1/2)"/>' +
    '</lines><methods><method><lines><line number="1" hits="2"/></lines></method></methods></class>' +
    '<class filename="C:\\other\\B.cs"><lines><line number="1" hits="1"/></lines></class></classes></package></packages></coverage>';
  const result = parseCobertura(source, {workspaceRoot: 'C:/repo'});
  assert.equal(result.totalLines, 2);
  assert.equal(result.coveredLines, 1);
  assert.equal(result.files[0].lines[1].coveredBranches, 1);
  assert.equal(result.files[0].lines[1].totalBranches, 2);
  assert.equal(result.diagnostics[0].code, 'SFT2302');
  assert.throws(() => parseCobertura('<coverage><class filename="A.cs"><line number="0" hits="1"/></class></coverage>'), /one-based/);
});
