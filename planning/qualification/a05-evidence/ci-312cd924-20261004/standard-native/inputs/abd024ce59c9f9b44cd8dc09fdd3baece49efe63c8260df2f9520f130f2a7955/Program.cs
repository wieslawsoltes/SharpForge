using System;
struct Counter {
  public int Value;
  public Counter(int value) { Value = value; }
  public int Next() { Value++; return Value; }
}
class Buffer {
  private int[] values = new int[2];
  public ref int this[int index] { get { return ref values[index]; } }
}
class Program {
  static void Swap(ref int first, ref int second) {
    int saved = first; first = second; second = saved;
  }
  static void Assign(out int value) { value = 31; }
  static int Observe(in Counter value) { return value.Next(); }
  static void Main() {
    Buffer buffer = new Buffer();
    buffer[0] = 5; buffer[1] = 9;
    Swap(ref buffer[0], ref buffer[1]);
    Swap(ref buffer[0], ref buffer[0]);
    Console.WriteLine(buffer[0]); Console.WriteLine(buffer[1]);
    ref int alias = ref buffer[1];
    Assign(out alias);
    GC.Collect();
    alias += 1;
    Console.WriteLine(buffer[1]);
    int local; Assign(out local); Console.WriteLine(local);
    Counter counter = new Counter(7);
    Console.WriteLine(Observe(in counter));
    Console.WriteLine(counter.Value);
    try { Assign(out buffer[2]); }
    catch (IndexOutOfRangeException) { Console.WriteLine("bounds"); }
  }
}