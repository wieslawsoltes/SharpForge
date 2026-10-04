using System;
using System.Collections.Generic;
using System.Text;

public static class Program
{
    private static string Scan(string text)
    {
        var output = new StringBuilder();
        int i = 0;
    next:
        if (i >= text.Length) goto done;
        char c = text[i++];
        if (c == ' ') goto next;
        if (char.IsDigit(c))
        {
            int value = c - '0';
            while (i < text.Length && char.IsDigit(text[i])) value = value * 10 + (text[i++] - '0');
            output.Append('#').Append(value);
            goto next;
        }
        if (c == '/' && i < text.Length && text[i] == '/') goto done;
        output.Append(c);
        goto next;
    done:
        return output.ToString();
    }

    private static string Grade(int score)
    {
        string result = "";
        switch (score / 10)
        {
            case 10:
                result += "perfect ";
                goto case 9;
            case 9:
                result += "A";
                break;
            case 8:
                result += "B";
                break;
            case 7:
            case 6:
                result += "C";
                if (score % 10 >= 5) goto case 8;
                break;
            case 0:
                goto default;
            default:
                result += "F";
                if (score < 0) goto case 10;
                break;
        }
        return result;
    }

    private static (int Row, int Column) Find(int[,] grid, int target)
    {
        int row = 0, column = 0;
        for (row = 0; row < grid.GetLength(0); row++)
        {
            for (column = 0; column < grid.GetLength(1); column++)
            {
                if (grid[row, column] == target) goto found;
            }
        }
        return (-1, -1);
    found:
        return (row, column);
    }

    private static string Loops()
    {
        var output = new StringBuilder();
        for (int i = 0, j = 10; i < j; i += 2, j--)
        {
            if (i == 2) continue;
            output.Append(i).Append(':').Append(j).Append(' ');
        }
        int n = 27, steps = 0;
        do
        {
            n = n % 2 == 0 ? n / 2 : 3 * n + 1;
            steps++;
            if (steps > 200) break;
        } while (n != 1);
        output.Append("collatz=").Append(steps).Append(' ');
        int outer = 0, total = 0;
        while (true)
        {
            outer++;
            for (int inner = 0; ; inner++)
            {
                if (inner > outer) break;
                if ((inner + outer) % 2 == 0) continue;
                total += inner * outer;
            }
            if (outer >= 6) break;
        }
        output.Append("total=").Append(total).Append(' ');
        foreach (var word in new[] { "skip", "keep", "stop", "never" })
        {
            if (word == "skip") continue;
            if (word == "stop") break;
            output.Append(word);
        }
        int k = 5;
        while (k-- > 0) if (k == 2) break;
        output.Append(" k=").Append(k);
        for (; ; ) { if (++k > 7) break; }
        output.Append(" k=").Append(k);
        return output.ToString();
    }

    private static int Retry(Func<int, bool> attempt)
    {
        int tries = 0;
    again:
        tries++;
        try
        {
            if (!attempt(tries)) throw new InvalidOperationException();
        }
        catch (InvalidOperationException)
        {
            if (tries < 5) goto again;
            return -tries;
        }
        finally
        {
            log.Add("finally " + tries);
        }
        return tries;
    }

    private static readonly List<string> log = new List<string>();

    private static string Nested()
    {
        var output = new StringBuilder();
        for (int a = 0; a < 3; a++)
        {
            for (int b = 0; b < 3; b++)
            {
                for (int c = 0; c < 3; c++)
                {
                    if (c == 2) goto nextB;
                    if (a == 2 && b == 1) goto finished;
                    output.Append(a).Append(b).Append(c).Append(' ');
                }
            nextB:;
            }
        }
    finished:
        output.Append("end");
        return output.ToString();
    }

    private static IEnumerable<int> Counted(int limit)
    {
        int i = 0;
    loop:
        if (i >= limit) yield break;
        yield return i++;
        goto loop;
    }

    public static void Main()
    {
        Console.WriteLine(Scan("ab 12 c345d 6 // comment 7") + " " + Scan("") + " " + Scan("9/8"));
        foreach (int score in new[] { 100, 95, 85, 75, 65, 60, 55, 5, -20 }) Console.Write(Grade(score) + "|");
        Console.WriteLine();
        var grid = new int[,] { { 1, 2, 3 }, { 4, 5, 6 }, { 7, 8, 9 } };
        Console.WriteLine(Find(grid, 6) + " " + Find(grid, 1) + " " + Find(grid, 10));
        Console.WriteLine(Loops());
        Console.WriteLine(Retry(attempt => attempt >= 3) + " " + Retry(_ => false) + " " + string.Join(",", log));
        Console.WriteLine(Nested());
        Console.WriteLine(string.Join("", Counted(5)));
    }
}
