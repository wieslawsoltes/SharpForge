const int Base = 6 * 7;
const int Mask = (1 << 4) - 1;
const int Wrapped = unchecked(2147483647 + 1);
int value = 42;
switch (value)
{
    case Base: Console.WriteLine("answer"); break;
    default: Console.WriteLine("other"); break;
}
Console.WriteLine(Mask);
Console.WriteLine(Wrapped);
Console.WriteLine(value switch { Base => "matched", _ => "other" });
