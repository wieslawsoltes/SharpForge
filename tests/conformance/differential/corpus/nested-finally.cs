using System;
class Program { static void Main() { try { try { throw new Exception("seeded"); } finally { Console.WriteLine("inner"); } } catch(Exception ex) { Console.WriteLine(ex.Message); } finally { Console.WriteLine("outer"); } } }
