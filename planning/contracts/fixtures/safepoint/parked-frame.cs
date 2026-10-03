using System;
using System.Threading.Tasks;
class Program {
  static async Task Main() {
    string[] live = new string[] { "parked-root" };
    await Task.Delay(5);
    GC.Collect();
    Console.WriteLine(live[0]);
  }
}
