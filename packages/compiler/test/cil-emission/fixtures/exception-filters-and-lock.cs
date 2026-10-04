using System;

class CodedException : Exception
{
    public int Code;
    public CodedException(int code) : base("coded " + code) { Code = code; }
}

class Counter
{
    readonly object gate = new object();
    int value;

    public int Add(int amount)
    {
        lock (gate)
        {
            value += amount;
            return value;
        }
    }

    public void Fail()
    {
        lock (gate)
        {
            value = -1;
            throw new InvalidOperationException("failed while locked");
        }
    }

    public int Sum(int[] values)
    {
        int sum = 0;
        foreach (int item in values)
        {
            lock (gate)
            {
                if (item < 0) continue;
                if (item > 100) break;
                sum += item;
            }
        }
        return sum;
    }
}

class Program
{
    static int filterCalls;

    static bool Check(string label, bool result)
    {
        filterCalls++;
        Console.WriteLine("filter " + label + " -> " + result);
        return result;
    }

    static void Throw(int code)
    {
        try
        {
            throw new CodedException(code);
        }
        finally
        {
            Console.WriteLine("inner finally " + code);
        }
    }

    static string Classify(int code)
    {
        try
        {
            Throw(code);
            return "none";
        }
        catch (CodedException e) when (e.Code == 1)
        {
            return "one";
        }
        catch (CodedException e) when (Check("even", e.Code % 2 == 0))
        {
            return "even " + e.Code;
        }
        catch (CodedException) when (Check("no variable", code == 5))
        {
            return "five";
        }
        catch (Exception e)
        {
            return "other " + e.Message;
        }
    }

    static string General(Action action)
    {
        int attempts = 0;
        try
        {
            action();
            return "completed";
        }
        catch when (++attempts > 0 && Check("general", true))
        {
            return "general after " + attempts;
        }
    }

    static void Unmatched()
    {
        try
        {
            try
            {
                throw new ArgumentException("argument");
            }
            catch (InvalidOperationException) when (Check("wrong type", true))
            {
                Console.WriteLine("not reached");
            }
            catch (ArgumentException e) when (Check("refuses", false))
            {
                Console.WriteLine("not reached " + e.Message);
            }
            finally
            {
                Console.WriteLine("finally of the refusing try");
            }
        }
        catch (ArgumentException e)
        {
            Console.WriteLine("outer caught " + e.Message);
        }
    }

    static void Main()
    {
        Console.WriteLine(Classify(1));
        Console.WriteLine(Classify(4));
        Console.WriteLine(Classify(5));
        Console.WriteLine(Classify(7));
        Console.WriteLine(General(() => throw new NotSupportedException()));
        Console.WriteLine(General(() => { }));
        Unmatched();
        Console.WriteLine("filters ran " + filterCalls);

        Counter counter = new Counter();
        Console.WriteLine(counter.Add(2));
        Console.WriteLine(counter.Add(3));
        try
        {
            counter.Fail();
        }
        catch (InvalidOperationException e)
        {
            Console.WriteLine(e.Message);
        }
        Console.WriteLine(counter.Add(11));
        Console.WriteLine(counter.Sum(new[] { 1, -5, 2, 500, 4 }));

        object first = new object(), second = "second";
        lock (first)
        {
            lock (second)
            {
                Console.WriteLine("nested");
            }
            Console.WriteLine("inner released");
        }
        Console.WriteLine("released");
    }
}
