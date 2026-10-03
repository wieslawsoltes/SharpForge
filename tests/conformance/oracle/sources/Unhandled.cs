using System; class Program { static void Main() { Console.WriteLine("before throw"); throw new InvalidOperationException("oracle failure"); } }
