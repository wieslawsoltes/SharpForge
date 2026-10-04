using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public enum EntryKind { Debit, Credit }

public readonly struct Amount : IComparable<Amount>, IEquatable<Amount>, IFormattable
{
    private readonly decimal value;
    public Amount(decimal value) { this.value = decimal.Round(value, 2, MidpointRounding.ToEven); }
    public static Amount Zero => new Amount(0);
    public decimal Value => value;
    public static Amount operator +(Amount a, Amount b) => new Amount(a.value + b.value);
    public static Amount operator -(Amount a, Amount b) => new Amount(a.value - b.value);
    public static Amount operator *(Amount a, decimal factor) => new Amount(a.value * factor);
    public static Amount operator /(Amount a, int parts) => new Amount(a.value / parts);
    public static Amount operator -(Amount a) => new Amount(-a.value);
    public static bool operator >(Amount a, Amount b) => a.value > b.value;
    public static bool operator <(Amount a, Amount b) => a.value < b.value;
    public static bool operator ==(Amount a, Amount b) => a.value == b.value;
    public static bool operator !=(Amount a, Amount b) => a.value != b.value;
    public static implicit operator Amount(decimal value) => new Amount(value);
    public static implicit operator Amount(int value) => new Amount(value);
    public int CompareTo(Amount other) => value.CompareTo(other.value);
    public bool Equals(Amount other) => value == other.value;
    public override bool Equals(object obj) => obj is Amount other && Equals(other);
    public override int GetHashCode() => value.GetHashCode();
    public override string ToString() => ToString("N2", CultureInfo.InvariantCulture);
    public string ToString(string format, IFormatProvider provider) => value.ToString(format ?? "N2", provider ?? CultureInfo.InvariantCulture);

    public Amount[] Split(int parts)
    {
        var share = this / parts;
        var result = Enumerable.Repeat(share, parts).ToArray();
        decimal remainder = value - share.value * parts;
        for (int i = 0; remainder != 0; i++)
        {
            decimal step = remainder > 0 ? 0.01m : -0.01m;
            result[i] = new Amount(result[i].value + step);
            remainder -= step;
        }
        return result;
    }
}

public sealed record Entry(int Id, string Account, EntryKind Kind, Amount Amount, string Memo);

public sealed class Ledger
{
    private readonly List<Entry> entries = new List<Entry>();
    private int nextId = 1;

    public void Post(string debit, string credit, Amount amount, string memo)
    {
        if (amount < Amount.Zero || amount == Amount.Zero) throw new ArgumentException("amount must be positive: " + amount);
        entries.Add(new Entry(nextId++, debit, EntryKind.Debit, amount, memo));
        entries.Add(new Entry(nextId++, credit, EntryKind.Credit, amount, memo));
    }

    public Amount Balance(string account) => entries.Where(e => e.Account == account).Aggregate(Amount.Zero, (sum, e) => e.Kind == EntryKind.Debit ? sum + e.Amount : sum - e.Amount);
    public IEnumerable<(string Account, Amount Balance)> TrialBalance() => entries.Select(e => e.Account).Distinct().OrderBy(a => a, StringComparer.Ordinal).Select(a => (a, Balance(a)));
    public bool Balanced => entries.Where(e => e.Kind == EntryKind.Debit).Sum(e => e.Amount.Value) == entries.Where(e => e.Kind == EntryKind.Credit).Sum(e => e.Amount.Value);
    public int Count => entries.Count;
}

public static class Program
{
    private static decimal Compound(decimal principal, decimal rate, int years)
    {
        for (int year = 0; year < years; year++) principal += decimal.Round(principal * rate, 2);
        return principal;
    }

    public static void Main()
    {
        var invariant = CultureInfo.InvariantCulture;
        var ledger = new Ledger();
        ledger.Post("cash", "equity", 10_000, "initial capital");
        ledger.Post("inventory", "cash", 2_499.99m, "stock purchase");
        ledger.Post("cash", "sales", 1_234.565m, "sale rounds to even");
        ledger.Post("rent", "cash", new Amount(800) * 1.075m, "rent with tax");
        ledger.Post("cash", "sales", (Amount)0.1m + 0.2m, "small sale");
        foreach (var (account, balance) in ledger.TrialBalance()) Console.WriteLine($"{account,-10}{balance,12}{(balance < Amount.Zero ? " CR" : " DR")}");
        Console.WriteLine(ledger.Balanced + " " + ledger.Count + " " + ledger.Balance("nothing") + " " + ledger.TrialBalance().Max(row => row.Balance) + " " + ledger.TrialBalance().Sum(row => row.Balance.Value));
        try { ledger.Post("a", "b", -5, "negative"); }
        catch (ArgumentException e) { Console.WriteLine(e.Message); }

        Console.WriteLine(string.Join(" ", new Amount(100).Split(3)) + " | " + string.Join(" ", new Amount(-0.05m).Split(3)) + " | " + new Amount(100).Split(3).Aggregate(Amount.Zero, (a, b) => a + b) + " " + $"{new Amount(1234.5m):C} {new Amount(0.5m):P0} {new Amount(7):000.000}");
        decimal third = 1m / 3;
        Console.WriteLine((third * 3).ToString(invariant) + " " + (third * 3 == 1m) + " " + (0.1m + 0.2m == 0.3m) + " " + (0.1 + 0.2 == 0.3) + " " + 1.10m + " " + (1.10m == 1.1m) + " " + (1.10m).ToString(invariant).Length + " " + decimal.Round(2.5m) + decimal.Round(3.5m) + " " + Math.Round(2.5m, MidpointRounding.AwayFromZero) + " " + decimal.Truncate(-2.7m) + decimal.Floor(-2.7m) + decimal.Ceiling(-2.7m));
        Console.WriteLine(Compound(1000m, 0.05m, 10).ToString(invariant) + " " + (1000m * (decimal)Math.Pow(1.05, 10)).ToString("F2", invariant) + " " + (decimal.MaxValue / 3).ToString(invariant) + " " + (79228162514264337593543950335m % 1000) + " " + (5m % 3) + " " + (-5.5m % 2) + " " + (1e-28m + 1e-28m).ToString(invariant) + " " + (7m / 2 * 2) + " " + (decimal)(float)0.1 + " " + (double)0.1m);
        decimal d = 12345.6789m;
        Console.WriteLine(string.Join(" ", d.ToString("N1", invariant), d.ToString("F0", invariant), d.ToString("0,0.00", invariant), d.ToString("E3", invariant), d.ToString("#.##%", invariant), (-d).ToString("0.0;(0.0);zero", invariant), 0m.ToString("0.0;(0.0);zero", invariant), ((int)d).ToString("D8"), (long)(d * 100), decimal.Parse("1,234.50", NumberStyles.Number, invariant), decimal.TryParse("abc", out _)));
        int count = 3; long big = 4_000_000_000; float f = 0.5f;
        var mixed = d + count;
        var scaled = big * 0.25m;
        Console.WriteLine(mixed.GetType().Name + " " + scaled + " " + (decimal)f + " " + (count / 2m) + " " + (int)(d % 7) + " " + (d > count) + " " + Math.Sign(-d) + " " + Math.Abs(-d).ToString(invariant) + " " + Math.Max(d, 1e4m) + " " + decimal.Negate(d).CompareTo(d) + " " + decimal.GetBits(1.5m)[3].ToString("X") + " " + ++d + " " + d--);
    }
}
