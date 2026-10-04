import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';

export const counterLibrarySource = `public class Counter {
  public static int Total = 40;
  public int Field = 1;
  public int Value { get; set; }
  public Counter(int value) { Field += value; Value = value; }
  public void Add(int value) { Field += value; Value += value; }
  public Counter Self() { return this; }
  public int Constant() { return 42; }
  public static int Answer() { return Total + 2; }
}`;

export const counterApplicationSource = `var counter = new Counter(40);
counter.Add(1);
Counter.Total += 2;
counter.Value = Counter.Total;
System.Console.WriteLine(counter.Field);
System.Console.WriteLine(counter.Self().Value);
System.Console.WriteLine(Counter.Answer());
Counter absent = null;
try { System.Console.WriteLine(absent.Constant()); }
catch (System.Exception) { System.Console.WriteLine("null"); }`;

export function projectLibrary(name = 'Library', source = counterLibrarySource, options = {}) {
  const result = compileToIL(source, {...options, name, outputKind: 'library'});
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result;
}

export function projectApplication(source, dependencies, options = {}) {
  const result = compileToIL(source, {name: 'App', ...options,
    references: dependencies.map(dependency => ({bytes: dependency.assembly ?? dependency,
      runtimeProfile: 'sharpforge', ...(dependency.aliases ? {aliases: dependency.aliases} : {})}))});
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result;
}
