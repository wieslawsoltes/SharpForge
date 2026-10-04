/** Fixed complete workload: nested frame, array-interior and field-interior writes survive guest collections. */
export const byrefLatencyFixture = Object.freeze({
  id: 'nested-managed-references',
  iterations: 256,
  depth: 4,
  expected: '256\n512\n768\n',
  source: `using System;
class Cell { public int Value; }
class Program {
  static void Leaf(ref int local, ref int element, ref int field) {
    local += 1; element += 2; field += 3;
    if ((local & 63) == 0) GC.Collect();
  }
  static void Nested(int depth, ref int local, ref int element, ref int field) {
    if (depth == 0) Leaf(ref local, ref element, ref field);
    else Nested(depth - 1, ref local, ref element, ref field);
  }
  static void Main() {
    int local = 0;
    int[] values = new int[1];
    Cell cell = new Cell();
    for (int index = 0; index < 256; index++) {
      Nested(4, ref local, ref values[0], ref cell.Value);
    }
    Console.WriteLine(local);
    Console.WriteLine(values[0]);
    Console.WriteLine(cell.Value);
  }
}`
});
