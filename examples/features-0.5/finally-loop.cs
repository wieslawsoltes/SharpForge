for (int i = 0; i < 4; i++)
{
    try
    {
        if (i == 0) continue;
        if (i == 2) break;
        Console.WriteLine(i);
    }
    finally { Console.WriteLine("cleanup " + i); }
}
Console.WriteLine("done");
