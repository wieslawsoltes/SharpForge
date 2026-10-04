using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public readonly struct Currency : IEquatable<Currency>
{
    private readonly string code;
    private Currency(string code) { this.code = code; }
    public static readonly Currency Usd = new Currency("USD"), Eur = new Currency("EUR"), Jpy = new Currency("JPY");
    public static implicit operator string(Currency currency) => currency.code ?? "XXX";
    public static explicit operator Currency(string code) => code.Length == 3 ? new Currency(code.ToUpperInvariant()) : throw new FormatException("bad currency '" + code + "'");
    public int Decimals
    {
        get
        {
            switch (this) // governed by the user-defined implicit conversion to string
            {
                case "JPY": return 0;
                case "USD":
                case "EUR": return 2;
                default: return 3;
            }
        }
    }
    public bool Equals(Currency other) => (string)this == (string)other;
    public override bool Equals(object obj) => obj is Currency other && Equals(other);
    public override int GetHashCode() => ((string)this).GetHashCode();
    public static bool operator ==(Currency a, Currency b) => a.Equals(b);
    public static bool operator !=(Currency a, Currency b) => !a.Equals(b);
}

public readonly struct Money : IComparable<Money>, IEquatable<Money>
{
    public Money(long minor, Currency currency) { Minor = minor; Currency = currency; }
    public long Minor { get; }
    public Currency Currency { get; }
    private long Scale => Currency.Decimals switch { 0 => 1, 2 => 100, _ => 1000 };
    private static Currency Same(Money a, Money b) => a.Currency == b.Currency ? a.Currency : throw new InvalidOperationException("currency mismatch " + a.Currency + "/" + b.Currency);

    public static implicit operator Money(int dollars) => new Money(dollars * 100L, Currency.Usd);
    public static implicit operator Money(decimal dollars) => new Money((long)Math.Round(dollars * 100m, MidpointRounding.AwayFromZero), Currency.Usd);
    public static explicit operator decimal(Money money) => (decimal)money.Minor / money.Scale;
    public static explicit operator int(Money money) => unchecked((int)(money.Minor / money.Scale));
    public static explicit operator checked int(Money money) => checked((int)(money.Minor / money.Scale));

    public static Money operator +(Money a) => a;
    public static Money operator -(Money a) => new Money(unchecked(-a.Minor), a.Currency);
    public static Money operator checked -(Money a) => new Money(checked(-a.Minor), a.Currency);
    public static Money operator ++(Money a) => new Money(a.Minor + a.Scale, a.Currency);
    public static Money operator --(Money a) => new Money(a.Minor - a.Scale, a.Currency);
    public static Money operator +(Money a, Money b) => new Money(unchecked(a.Minor + b.Minor), Same(a, b));
    public static Money operator checked +(Money a, Money b) => new Money(checked(a.Minor + b.Minor), Same(a, b));
    public static Money operator -(Money a, Money b) => new Money(unchecked(a.Minor - b.Minor), Same(a, b));
    public static Money operator checked -(Money a, Money b) => new Money(checked(a.Minor - b.Minor), Same(a, b));
    public static Money operator *(Money a, decimal factor) => new Money((long)Math.Round(a.Minor * factor, MidpointRounding.ToEven), a.Currency);
    public static Money operator *(decimal factor, Money a) => a * factor;
    public static Money operator /(Money a, decimal divisor) => new Money((long)Math.Round(a.Minor / divisor, MidpointRounding.ToEven), a.Currency);
    public static decimal operator /(Money a, Money b) => Same(a, b) == a.Currency ? (decimal)a.Minor / b.Minor : 0m;
    public static Money operator %(Money a, long minorUnits) => new Money(a.Minor % minorUnits, a.Currency);

    public int CompareTo(Money other) => Same(this, other) == Currency ? Minor.CompareTo(other.Minor) : 0;
    public bool Equals(Money other) => Minor == other.Minor && Currency == other.Currency;
    public override bool Equals(object obj) => obj is Money other && Equals(other);
    public override int GetHashCode() => HashCode.Combine(Minor, (string)Currency);
    public static bool operator ==(Money a, Money b) => a.Equals(b);
    public static bool operator !=(Money a, Money b) => !a.Equals(b);
    public static bool operator <(Money a, Money b) => a.CompareTo(b) < 0;
    public static bool operator >(Money a, Money b) => a.CompareTo(b) > 0;
    public static bool operator <=(Money a, Money b) => a.CompareTo(b) <= 0;
    public static bool operator >=(Money a, Money b) => a.CompareTo(b) >= 0;
    public override string ToString() => Currency + " " + ((decimal)this).ToString("F" + Currency.Decimals, CultureInfo.InvariantCulture);
}

public sealed class Wallet
{
    private readonly SortedDictionary<string, long> balances = new SortedDictionary<string, long>();
    public int Version { get; private set; }
    public int Mutations { get; private set; }
    public Money this[Currency currency] => new Money(balances.TryGetValue(currency, out long minor) ? minor : 0, currency);

    // C# 14 instance compound assignment and increment operators: they mutate this wallet in place.
    public void operator +=(Money amount) { balances[amount.Currency] = this[amount.Currency].Minor + amount.Minor; Mutations++; }
    public void operator -=(Money amount)
    {
        if (this[amount.Currency] < amount) throw new InvalidOperationException("insufficient " + amount.Currency);
        balances[amount.Currency] = this[amount.Currency].Minor - amount.Minor;
        Mutations++;
    }
    public void operator *=(int factor) { foreach (string key in balances.Keys.ToList()) balances[key] = unchecked(balances[key] * factor); Mutations++; }
    public void operator checked *=(int factor) { foreach (string key in balances.Keys.ToList()) balances[key] = checked(balances[key] * factor); Mutations++; }
    public void operator ++() => Version++;
    public static Wallet operator +(Wallet wallet, Money amount)
    {
        var copy = new Wallet { Version = wallet.Version + 100 };
        foreach (var pair in wallet.balances) copy.balances[pair.Key] = pair.Value;
        copy += amount;
        return copy;
    }
    public override string ToString() => "v" + Version + "/m" + Mutations + " [" + string.Join(", ", balances.Select(b => new Money(b.Value, (Currency)b.Key))) + "]";
}

public struct Accumulator
{
    public long Total;
    public int Count;
    public void operator +=(Money amount) { Total += amount.Minor; Count++; }
    public void operator ++() => Count++;
}

public static class Program
{
    private static string Kind(Money value) => "money";
    private static string Kind(decimal value) => "decimal";
    private static string Kind(object value) => "object";
    private static Money Fee(Money amount) => amount > 100 ? 2.5m : 0;
    private static Money Floor(Money amount, bool waive) => waive ? amount : 0;
    private static string Try(Func<object> compute) { try { return compute().ToString(); } catch (Exception e) when (e is OverflowException or InvalidOperationException or FormatException) { return e.GetType().Name; } }

    public static void Main()
    {
        Money price = 19.99m, ten = 10, yen = new Money(1500, Currency.Jpy), euro = new Money(250, Currency.Eur);
        Console.WriteLine("basics: " + price + " " + ten + " " + yen + " " + euro + " " + new Money(5, default) + " | " + (price + ten) + " " + (price - 20) + " " + -price + " " + +price + " " + price * 3 + " " + 0.5m * price + " " + price / 3
            + " " + (price / ten).ToString(CultureInfo.InvariantCulture) + " " + price % 100 + " " + (yen * 1.1m) + " " + (Money)0.005m + " " + (Money)(-0.005m) + " " + (Money)0.015m);

        Money counter = 1.5m;
        Money post = counter++, pre = ++counter, down = --counter;
        counter--;
        Console.WriteLine("increments: " + post + " " + pre + " " + down + " " + counter + " | compare: " + (price < ten) + " " + (price >= 19.99m) + " " + (ten == 10) + " " + (ten != 10.00m) + " " + (price > 19) + " " + ten.Equals((object)(Money)10)
            + " " + price.CompareTo(20) + " " + (yen == new Money(1500, (Currency)"jpy")) + " " + Try(() => yen < euro) + " " + Try(() => yen + euro) + " " + Try(() => (Currency)"dollar"));

        // Conversion chains: user-defined explicit conversions followed or preceded by standard ones.
        Money big = new Money(123_456_789_012_345, Currency.Usd);
        Console.WriteLine("conversions: " + ((decimal)price).ToString(CultureInfo.InvariantCulture) + " " + (int)price + " " + (long)price + " " + ((double)price).ToString(CultureInfo.InvariantCulture) + " " + (short)price + " " + (int)yen
            + " " + ((float)(decimal)price).ToString(CultureInfo.InvariantCulture) + " " + (Money)(byte)7 + " " + (Money)'A' + " " + (Money)3L + " " + unchecked((int)big) + " " + Try(() => checked((int)big)) + " " + checked((int)price)
            + " " + (string)Currency.Eur + ((string)default(Currency)).Length + " " + string.Concat(yen.Currency, "/", euro.Currency) + " " + yen.Currency.Decimals + default(Currency).Decimals);
        Console.WriteLine("overloads: " + Kind(price) + " " + Kind(5) + " " + Kind(5L) + " " + Kind(5.5m) + " " + Kind(5.5) + " " + Kind("5") + " " + Kind((Money)5) + " | fees: " + Fee(250) + " " + Fee(99.99m) + " " + Fee(price * 10)
            + " " + Floor(price, true) + " " + Floor(price, false));

        Money max = new Money(long.MaxValue - 5, Currency.Usd), min = new Money(long.MinValue, Currency.Usd);
        Console.WriteLine("checked: " + unchecked(max + ten).Minor + " " + Try(() => checked(max + ten)) + " " + Try(() => checked(max + (Money)0.05m).Minor) + " " + unchecked(-min).Minor + " " + Try(() => checked(-min))
            + " " + Try(() => checked(min - ten)) + " " + unchecked(min - ten).Minor + " " + Try(() => checked(-max).Minor));

        // Lifted operators over Money?: null propagates through arithmetic, comparisons are false, equality is defined.
        Money? some = price, none = null;
        Money? sum = some + none, doubled = some + some, negated = -none, scaled = some * 2;
        some++;
        Console.WriteLine("lifted: " + (sum.HasValue ? "value" : "null") + " " + doubled + " " + (negated?.ToString() ?? "null") + " " + scaled + " " + some + " " + (some < none) + " " + (some >= none) + " " + (none <= negated) + " " + (none == negated) + " " + (some == none)
            + " " + (none == null) + " " + (some != none) + " " + (some > ten) + " " + ((decimal?)none).HasValue + " " + ((decimal?)some)?.ToString(CultureInfo.InvariantCulture) + " " + ((int?)some ?? -1) + " " + (none ?? ten) + " " + (some + 1 ?? ten));

        // Conversions applied by foreach, plus LINQ over the operators.
        var receipts = new List<Money>();
        foreach (Money amount in new decimal[] { 12.5m, 7.25m, 0.999m, 12.5m }) receipts.Add(amount);
        decimal plain = 0;
        foreach (decimal amount in receipts) plain += amount;
        Console.WriteLine("receipts: " + string.Join(" ", receipts) + " | sum " + receipts.Aggregate((Money)0, (a, b) => a + b) + " = " + plain.ToString(CultureInfo.InvariantCulture) + " max " + receipts.Max() + " min " + receipts.Min()
            + " distinct " + receipts.Distinct().Count() + " sorted " + string.Join("<", receipts.OrderBy(m => m).Select(m => m.Minor)) + " above ten: " + receipts.Count(m => m > ten) + " avg " + receipts.Aggregate((Money)0, (a, b) => a + b) / receipts.Count);

        foreach (var group in receipts.Concat(new[] { yen, euro, euro * 2 }).GroupBy(m => (string)m.Currency).OrderBy(g => g.Key, StringComparer.Ordinal))
            Console.WriteLine("  by currency " + group.Key + ": " + group.Count() + " item(s), total " + group.Aggregate((a, b) => checked(a + b)) + ", largest " + group.Max() + ", spread " + (group.Max() - group.Min()));

        var wallet = new Wallet();
        Wallet alias = wallet;
        wallet += price;
        wallet += yen;
        wallet += euro;
        wallet -= 5;
        wallet++;
        ++wallet;
        Console.WriteLine("wallet: " + wallet + " same=" + ReferenceEquals(alias, wallet) + " usd=" + wallet[Currency.Usd] + " none=" + wallet[(Currency)"GBP"]);
        Wallet copy = wallet + (Money)100;
        try { wallet -= new Money(1, (Currency)"GBP"); } catch (InvalidOperationException e) { Console.WriteLine("wallet: " + e.Message + " mutations=" + wallet.Mutations); }
        wallet *= 3;
        Console.WriteLine("wallet: " + wallet + " copy=" + copy + " distinct=" + !ReferenceEquals(copy, wallet));
        copy += max - 20_000;
        try { checked { copy *= 2; } } catch (OverflowException) { Console.WriteLine("wallet: checked *= overflowed at m" + copy.Mutations); }
        unchecked { copy *= 2; }
        Console.WriteLine("wallet: unchecked *= gives " + copy[Currency.Usd].Minor + " m" + copy.Mutations);

        var slots = new Accumulator[2];
        Accumulator local = default;
        foreach (Money amount in receipts) { local += amount; slots[amount > ten ? 1 : 0] += amount; }
        local++;
        slots[0]++;
        Console.WriteLine("accumulators: " + local.Total + "/" + local.Count + " " + slots[0].Total + "/" + slots[0].Count + " " + slots[1].Total + "/" + slots[1].Count);
    }
}
