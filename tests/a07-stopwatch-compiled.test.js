import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const source = `using System; using System.Diagnostics;
  var watch = new Stopwatch();
  Console.WriteLine(watch.IsRunning); Console.WriteLine(watch.ElapsedTicks);
  watch.Stop(); watch.Reset(); Console.WriteLine(watch.ToString());
  watch.Start(); watch.Start(); watch.Stop();
  Console.WriteLine(watch.ElapsedMilliseconds); Console.WriteLine(watch.Elapsed.TotalMilliseconds);
  Console.WriteLine(watch.Elapsed.TotalSeconds); Console.WriteLine(watch.ToString());
  object value = watch; Console.WriteLine(value.ToString());
  watch.Restart(); watch.Reset(); Console.WriteLine(watch.ElapsedMilliseconds); Console.WriteLine(watch.IsRunning);
  var another = Stopwatch.StartNew(); another.Stop(); Console.WriteLine(another.ElapsedTicks);
  Console.WriteLine(Stopwatch.GetTimestamp());
  Console.WriteLine(Stopwatch.GetElapsedTime(9007199254740993L).TotalMilliseconds);
  Console.WriteLine(Stopwatch.GetElapsedTime(1000L, 1500001000L).TotalMilliseconds);
  Console.WriteLine(Stopwatch.GetElapsedTime(1500000000L, 0L).TotalSeconds);
  Console.WriteLine(Stopwatch.GetElapsedTime(long.MaxValue, long.MinValue).TotalMilliseconds);
  Stopwatch missing = null;
  try { missing.Start(); } catch (Exception error) { Console.WriteLine(error.GetType().Name); }
`;

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`Stopwatch ${pipeline}/${engine}: complete public methods bind and dispatch with an exact injected clock`, () => {
      const program = compileToIL(source, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      let now = 9_007_199_254_740_993n;
      const options = {stopwatchClock: () => { const result = now; now += 1_500_000_000n; return result; }};
      const vm = engine === 'source' ? new VirtualMachine(program.image, options) : new CilVirtualMachine(program.assembly, options);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, 'False\n0\n00:00:00\n1500\n1500\n1.5\n00:00:01.5000000\n00:00:01.5000000\n' +
          '0\nFalse\n1500000000\n9007206754740993\n9000\n1500\n-1.5\n0\nNullReferenceException\n');
      } finally { vm.stop(); }
    });

    test(`Stopwatch ${pipeline}/${engine}: Frequency and IsHighResolution remain readonly field expressions`, () => {
      const program = compileToIL(`using System; using System.Diagnostics;
        Console.WriteLine(Stopwatch.Frequency); Console.WriteLine(Stopwatch.IsHighResolution);`, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const options = {stopwatchClock: () => { throw new Error('Readonly profile fields do not read a clock'); }};
      const vm = engine === 'source' ? new VirtualMachine(program.image, options) : new CilVirtualMachine(program.assembly, options);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '1000000000\nTrue\n');
      } finally { vm.stop(); }
    });

    test(`Stopwatch ${pipeline}/${engine}: host clock failures become catchable managed diagnostics`, () => {
      const program = compileToIL(`using System; using System.Diagnostics;
        try { Stopwatch.GetTimestamp(); }
        catch (Exception error) { Console.WriteLine(error.GetType().Name); Console.WriteLine(error.Message); }`, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const options = {stopwatchClock: () => { throw new Error('Host failure'); }};
      const vm = engine === 'source' ? new VirtualMachine(program.image, options) : new CilVirtualMachine(program.assembly, options);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, 'InvalidOperationException\nBCLSW0003: Stopwatch clock callback failed\n');
      } finally { vm.stop(); }
    });
  }
}
