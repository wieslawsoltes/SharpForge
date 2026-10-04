using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Text = System.String;

namespace Interop;

public enum DeclarationOnly { First, Second }

public class Primary(int value)
{
    public int Value => value;
}

public static class Fixture
{
    public static int Locals(int input)
    {
        const int Answer = 42;
        const string Message = "portable symbols";
        dynamic dynamicValue = input;
        (int left, string right) tuple = (Answer, Message);
        Text text = tuple.right;
        Func<int, int> closure = argument => argument + input;
        Func<int, int> staticLambda = argument => argument + 1;
        Console.WriteLine(dynamicValue);
        Console.WriteLine(text);
        return closure(tuple.left) + staticLambda(input);
    }

    public static async Task<int> Async(int value)
    {
        int before = value + 1;
        await Task.Yield();
        return before;
    }

    public static IEnumerable<int> Iterator(int count)
    {
        for (int index = 0; index < count; index++) yield return index;
    }
}
