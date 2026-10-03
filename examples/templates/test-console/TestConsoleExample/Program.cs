using System;

namespace TemplateExamples.TestConsole
{
    public class Program
    {
        public static void Main()
        {
            int actual = Add(20, 22);
            if (actual != 42)
                throw new Exception("Expected 42");
            Console.WriteLine("All self-tests passed.");
        }

        private static int Add(int a, int b)
        {
            return a + b;
        }
    }
}
