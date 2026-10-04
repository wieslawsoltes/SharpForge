using System;
using System.Collections.Generic;
using System.Globalization;

// Reduced from stress-operators/money-currency-wallet: user-defined conversions where the language applies them
// without a cast - the governing value of a switch statement, an operand of string concatenation, the element of a
// foreach, operands of lifted operators and lifted conversions over nullable values.
public readonly struct Currency
{
    private readonly string code;
    private Currency(string code) { this.code = code; }
    public static readonly Currency Usd = new Currency("USD"), Jpy = new Currency("JPY");
    public static implicit operator string(Currency currency) => currency.code ?? "XXX";
    public static explicit operator Currency(string code) => new Currency(code.ToUpperInvariant());
    public int Decimals
    {
        get
        {
            switch (this)
            {
                case "JPY": return 0;
                case "USD":
                case "EUR": return 2;
                default: return 3;
            }
        }
    }
}

public readonly struct Money
{
    public Money(long minor, Currency currency) { Minor = minor; Currency = currency; }
    public long Minor { get; }
    public Currency Currency { get; }
    public static implicit operator Money(int units) => new Money(units * 100L, Currency.Usd);
    public static implicit operator Money(decimal units) => new Money((long)(units * 100m), Currency.Usd);
    public static explicit operator decimal(Money money) => money.Minor / 100m;
    public static explicit operator int(Money money) => (int)(money.Minor / 100);
    public static Money operator +(Money a, Money b) => new Money(a.Minor + b.Minor, a.Currency);
    public static bool operator >(Money a, Money b) => a.Minor > b.Minor;
    public static bool operator <(Money a, Money b) => a.Minor < b.Minor;
    public override string ToString() => Currency + " " + ((decimal)this).ToString("F" + Currency.Decimals, CultureInfo.InvariantCulture);
}

public static class Program
{
    public static void Main()
    {
        Currency other = (Currency)"chf";
        Console.WriteLine(Currency.Usd.Decimals + " " + Currency.Jpy.Decimals + " " + other.Decimals + " " + default(Currency).Decimals);
        Console.WriteLine(Currency.Usd + "/" + other + "/" + default(Currency) + " " + ("in " + Currency.Jpy).Length);

        var receipts = new List<Money>();
        foreach (Money amount in new decimal[] { 12.5m, 7.25m }) receipts.Add(amount);
        foreach (Money amount in new[] { 3, 4 }) receipts.Add(amount);
        Console.WriteLine(string.Join(", ", receipts));

        Money ten = 10;
        Money? some = ten, none = null;
        Money? sum = some + 1, missing = none + 1;
        Console.WriteLine(sum + " " + (missing.HasValue ? "value" : "null") + " " + (some > 5) + " " + (none < 5) + " " + (some + 1 ?? ten));
        Console.WriteLine(((decimal?)none).HasValue + " " + ((decimal?)some)?.ToString(CultureInfo.InvariantCulture) + " " + ((int?)some ?? -1) + " " + ((int?)none ?? -1));
        try
        {
            Console.WriteLine((decimal)none);
        }
        catch (InvalidOperationException)
        {
            Console.WriteLine("no value");
        }
    }
}
