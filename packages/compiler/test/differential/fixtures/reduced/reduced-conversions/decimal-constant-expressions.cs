using System;
using System.Globalization;

// Reduced from stress-bignum/numeric-conversion-matrix: constant expressions over `decimal` (whose operators are
// methods of System.Decimal in a compilation with references) and a `char` constant computed by a cast.
public static class Program
{
    private const char NextLetter = (char)('a' + 1);
    private const char Plain = 'q';
    private const decimal Price = 19.99m * 3 + 0.03m;
    private const decimal Half = 1m / 2;
    private const decimal Negative = -Price;
    private const decimal Rest = 10m % 3m;
    private const decimal Mixed = 2 * 1.5m - 1;
    private const bool Cheap = Price < 100m;
    private const decimal Chosen = Cheap ? Price : 0m;
    private const decimal FromInt = 7;
    private const decimal Wide = 79228162514264337593543950335m - 1m;

    public static void Main()
    {
        const decimal local = Price * 2 + Half;
        Console.WriteLine(NextLetter + "" + Plain + (char)(NextLetter + 1));
        Console.WriteLine(Price.ToString(CultureInfo.InvariantCulture) + " " + Half.ToString(CultureInfo.InvariantCulture) + " " + Negative.ToString(CultureInfo.InvariantCulture));
        Console.WriteLine(Rest.ToString(CultureInfo.InvariantCulture) + " " + Mixed.ToString(CultureInfo.InvariantCulture) + " " + Cheap + " " + Chosen.ToString(CultureInfo.InvariantCulture));
        Console.WriteLine(FromInt.ToString(CultureInfo.InvariantCulture) + " " + Wide.ToString(CultureInfo.InvariantCulture) + " " + local.ToString(CultureInfo.InvariantCulture));
        Console.WriteLine((1.10m + 2.200m).ToString(CultureInfo.InvariantCulture) + " " + (1.0m * 1.00m).ToString(CultureInfo.InvariantCulture) + " " + (6.00m / 3m).ToString(CultureInfo.InvariantCulture));
    }
}
