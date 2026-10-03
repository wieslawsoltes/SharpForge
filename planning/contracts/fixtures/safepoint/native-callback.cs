using System;
class Program { static void Main() { string[] live = new string[] { "callback-root" }; for (int i = 0; i < 2; i++) { GC.Collect(); } Console.WriteLine(live[0]); } }
