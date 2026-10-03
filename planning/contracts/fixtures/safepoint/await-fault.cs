using System;
using System.Threading.Tasks;
class Program { static async Task Work() { await Task.Delay(1); throw new Exception("await-fault"); } static async Task Main() { try { await Work(); } catch (Exception e) { Console.WriteLine("await-catch"); } finally { Console.WriteLine("await-finally"); } } }
