using System;
using System.Threading.Tasks;

class Payload { public string Text; }
class Program
{
    static async Task<string> Work()
    {
        Payload payload = new Payload { Text = "old" };
        await Task.Delay(1);
        payload = new Payload { Text = "new" };
        await Task.Delay(1);
        GC.Collect();
        return payload.Text;
    }
    static async Task Main() { Console.WriteLine(await Work()); }
}
