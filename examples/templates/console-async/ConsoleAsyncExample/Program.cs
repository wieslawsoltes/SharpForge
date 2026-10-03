using System;
using System.Threading.Tasks;

namespace TemplateExamples.ConsoleAsync
{
    public class Program
    {
        public static async Task Main()
        {
            await Task.Delay(1);
            Console.WriteLine("Hello, async world!");
        }
    }
}
