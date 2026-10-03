using System;
using System.Threading;
class Program { static void Main() { string[] live = new string[] { "cancel-root" }; using var c = new CancellationTokenSource(); c.Cancel(); try { c.Token.ThrowIfCancellationRequested(); } catch (Exception e) { GC.Collect(); Console.WriteLine(live[0]); } } }
