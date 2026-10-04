int amount = 6;
var counter = new Counter();
int total = amount * counter.Value;
Console.WriteLine(total);
if (total > 0) { Console.WriteLine("positive"); }
else { Console.WriteLine("nonpositive"); }
class Counter { public int Value { get; set; } = 3; }
