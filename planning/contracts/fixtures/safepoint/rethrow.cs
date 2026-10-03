using System;
class Program { static void Main() { try { try { throw new Exception("first"); } catch (Exception e) { Console.WriteLine("rethrow"); throw; } } catch (Exception e) { Console.WriteLine(e.Message); } } }
