using System;
class Program { static void Main() { try { try { throw new Exception("first"); } finally { Console.WriteLine("inner"); } } catch (Exception e) { Console.WriteLine("catch"); } finally { Console.WriteLine("outer"); } } }
