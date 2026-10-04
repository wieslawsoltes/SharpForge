using System;
using System.Threading.Tasks;

class Payload
{
    public string Text;
}
class Program
{
    static int count;
    static async Task<string> Work()
    {
        Payload payload = new Payload { Text = "retained" };
        await Task.Delay(1);
        GC.Collect();
        await Task.Yield();
        count++;
        return payload.Text;
    }
    static async Task Main() { Console.WriteLine(await Work()); Console.WriteLine(count); }
}
