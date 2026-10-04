var cell = new Cell();
int[] values = new int[2];
try
{
    cell.Value = 40;
    values[0] = cell.Value;
    GC.Collect();
    values[1] = values[0] + 2;
    Console.WriteLine(values[1]);
}
finally { Console.WriteLine("cleanup"); }
class Cell { public int Value; }
