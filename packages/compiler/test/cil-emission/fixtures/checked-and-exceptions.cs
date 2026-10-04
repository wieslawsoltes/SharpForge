using System;

class MathError : Exception
{
    public MathError(string message) : base(message)
    {
    }
}

class Resource : IDisposable
{
    readonly string name;

    public Resource(string name)
    {
        this.name = name;
        Console.WriteLine("open " + name);
    }

    public void Dispose()
    {
        Console.WriteLine("close " + name);
    }
}

class Program
{
    static int Add(int a, int b)
    {
        return checked(a + b);
    }

    static string Try(int a, int b)
    {
        try
        {
            return "sum " + Add(a, b);
        }
        catch (OverflowException)
        {
            return "overflow";
        }
        finally
        {
            Console.WriteLine("finally " + a);
        }
    }

    static int Search(int[] values, int wanted)
    {
        for (int i = 0; i < values.Length; i++)
        {
            try
            {
                if (values[i] == wanted) return i;
                if (values[i] < 0) continue;
                if (values[i] > 100) break;
            }
            finally
            {
                Console.WriteLine("checked " + i);
            }
        }
        return -1;
    }

    static void Main()
    {
        Console.WriteLine(Try(1, 2));
        Console.WriteLine(Try(int.MaxValue, 1));
        int wrapped = unchecked(int.MaxValue + Search(new int[] { 7 }, 9) + 2);
        Console.WriteLine(wrapped);
        try
        {
            checked
            {
                byte b = 255;
                b++;
                Console.WriteLine(b);
            }
        }
        catch (OverflowException)
        {
            Console.WriteLine("byte overflow");
        }
        try
        {
            long big = long.MaxValue;
            int narrow = checked((int)big);
            Console.WriteLine(narrow);
        }
        catch (OverflowException)
        {
            Console.WriteLine("conversion overflow");
        }
        int zero = 0;
        try
        {
            Console.WriteLine(10 / zero);
        }
        catch (DivideByZeroException)
        {
            Console.WriteLine("divide by zero");
        }
        try
        {
            try
            {
                throw new MathError("custom");
            }
            catch (DivideByZeroException)
            {
                Console.WriteLine("wrong handler");
            }
            finally
            {
                Console.WriteLine("inner finally");
            }
        }
        catch (MathError error)
        {
            Console.WriteLine(error.Message);
        }
        catch (Exception)
        {
            Console.WriteLine("too general");
        }
        Console.WriteLine(Search(new int[] { 5, -1, 8, 200, 8 }, 8));
        Console.WriteLine(Search(new int[] { 5, 200, 8 }, 8));
        using (var first = new Resource("a"))
        using (var second = new Resource("b"))
        {
            Console.WriteLine("body");
        }
        try
        {
            using (var third = new Resource("c"))
            {
                throw new MathError("inside using");
            }
        }
        catch (MathError error)
        {
            Console.WriteLine(error.Message);
        }
    }
}
