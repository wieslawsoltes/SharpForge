// Set F9 on the total assignment; try condition i == 1, hit count 2, or a logpoint.
int total = 0;
try
{
    for (int i = 0; i < 3; i++)
    {
        total += i + 1;
        Console.WriteLine("checkpoint " + i + " = " + total);
    }
}
finally { Console.WriteLine("cleanup"); }
Console.WriteLine(total);
