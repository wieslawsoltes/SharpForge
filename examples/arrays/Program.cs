using System;

int[] values = new int[] { 42, 7, 19, 3, 28, 11 };

for (int i = 0; i < values.Length - 1; i++)
{
    for (int j = 0; j < values.Length - i - 1; j++)
    {
        if (values[j] > values[j + 1])
        {
            int temporary = values[j];
            values[j] = values[j + 1];
            values[j + 1] = temporary;
        }
    }
}

foreach (int value in values)
{
    Console.WriteLine(value);
}
