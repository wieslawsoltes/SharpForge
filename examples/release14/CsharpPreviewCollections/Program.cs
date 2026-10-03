using System.Collections.Generic;
List<int> seed = [1, 2];
List<int> values = [with(capacity: 16), ..seed, 3, 4];
Console.WriteLine(string.Join(",", values.ToArray()));
int count = 0;
outer: for (int row = 0; row < 3; row++)
{
    for (int column = 0; column < 4; column++)
    {
        if (column == 2) continue outer;
        if (row == 2) break outer;
        count += row * 10 + column;
    }
}
Console.WriteLine(count);
