using System.Threading.Tasks;
using SharpForge.Runtime;
class Program
{
    static async Task Main()
    {
        double[] a = [1.0, 2.0, 3.0];
        double[] b = [4.0, 5.0, 6.0];
        var sum = ParallelMath.SumAsync(a);
        var dot = ParallelMath.DotAsync(a, b);
        var addition = ParallelMath.AddAsync(a, b);
        Console.WriteLine($"sum: {await sum}");
        Console.WriteLine($"dot: {await dot}");
        var result = await addition;
        Console.WriteLine($"last: {result[2]}");
    }
}
