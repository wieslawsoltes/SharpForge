using System.Threading;
class Program
{
    static int result;
    static void Worker()
    {
        Thread.Sleep(500);
        result = 42;
        Console.WriteLine(Thread.CurrentThread.Name);
    }
    static void Main()
    {
        Thread worker = new Thread(Worker);
        worker.Name = "Calculation";
        worker.Start();
        worker.Join();
        Console.WriteLine(result);
    }
}
