import test from 'node:test';
import assert from 'node:assert/strict';
import {compilePropertyFixture, propertyEngines} from './helpers/a15-property-managed-fixture.js';

const source = `using Windows.Foundation; using Microsoft.UI.Xaml.Controls;
class Owner : Control {
  public Point Value;
  static Point Shared;
  static double Mutate(Point value) { value.X = 9; return value.X; }
  static Point Returned() { return Shared; }
  static double Change(ref Point value) { value.X = 11; return 0; }
  static void Observe(Point first, double ignored) { Console.WriteLine(first.X); }
  static void Main() {
    Point original = new Point(3, 4);
    Point copy = original; copy.X = 7;
    Console.WriteLine(original.X); Console.WriteLine(copy.X);
    Console.WriteLine(Mutate(original)); Console.WriteLine(original.X);
    Observe(original, Change(ref original)); Console.WriteLine(original.X);
    Owner owner = new Owner(); owner.Value = original; owner.Value.X = 13;
    Console.WriteLine(original.X); Console.WriteLine(owner.Value.X);
    copy = owner.Value; copy.X = 17; Console.WriteLine(owner.Value.X);
    Shared = original; Point returned = Returned(); returned.X = 19;
    Console.WriteLine(Shared.X); Console.WriteLine(returned.X);
    Point[] points = new Point[1]; points[0] = original; points[0].X = 23;
    Console.WriteLine(original.X); Console.WriteLine(points[0].X);
    object boxed = original; original.X = 29;
    Point unboxed = (Point)boxed; unboxed.X = 31;
    Point again = (Point)boxed;
    Console.WriteLine(again.X); Console.WriteLine(unboxed.X); Console.WriteLine(original.X);
  }
}`;
const expected = '3\n7\n9\n3\n3\n11\n11\n13\n13\n11\n19\n11\n23\n11\n31\n29\n';

test('registered UI values copy at locals, arguments, fields, returns, arrays and boxing boundaries', async () => {
  const built = compilePropertyFixture(source);
  for (const [name, vm] of propertyEngines(built)) {
    try {
      const result = await vm.runAsync();
      assert.equal(result.state, 'terminated', name + ': ' + JSON.stringify(result.fault));
      assert.equal(result.output, expected, name);
    } finally { vm.stop(); }
  }
});
