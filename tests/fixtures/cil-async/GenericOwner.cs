using System;
using System.Threading.Tasks;

class Holder<T>
{
    public T Value;
    public async Task<T> Read()
    {
        await Task.Yield();
        return Value;
    }
}

class Outer<T>
{
    public class Inner<U>
    {
        public async Task<T> First(T first, U second)
        {
            await Task.Yield();
            Console.WriteLine(second);
            return first;
        }
    }
}

class Program
{
    static async Task Main()
    {
        Console.WriteLine(await new Holder<int> { Value = 42 }.Read());
        Console.WriteLine(await new Holder<string> { Value = "owner text" }.Read());
        Console.WriteLine(await new Outer<string>.Inner<int>().First("nested owner", 17));
    }
}
