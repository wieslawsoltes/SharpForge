int Work() { var result = new Result(); try { return result.Value; } finally { Console.WriteLine("cleanup"); } }
Console.WriteLine(Work());
class Result { public int Value { get; set; } = 42; }
