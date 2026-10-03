using System;
class Program { static void Main() { Console.WriteLine("before"); throw new Exception("seeded failure"); } }
