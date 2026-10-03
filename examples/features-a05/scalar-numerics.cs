// Run in either managed engine after the scalar numeric profile is assembled.
uint counter = 4294967295U;
Console.WriteLine((ulong)counter);

float single = 16777216F;
double wide = 16777216D;
Console.WriteLine((single + 1F) - single);
Console.WriteLine((wide + 1D) - wide);

decimal price = 19.95M;
decimal tax = 0.20M;
Console.WriteLine(price + price * tax);

try
{
    Console.WriteLine(checked(counter + 1U));
}
catch (Exception error)
{
    Console.WriteLine(error.GetType().Name);
}
