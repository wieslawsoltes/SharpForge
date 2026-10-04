using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

static string F(decimal value) => value.ToString(CultureInfo.InvariantCulture);
static int Scale(decimal value) => (decimal.GetBits(value)[3] >> 16) & 0xFF;

// Rounding modes side by side on the classic midpoint cases.
decimal[] midpoints = { 0.5m, 1.5m, 2.5m, -0.5m, -1.5m, -2.5m, 2.45m, 2.55m, -2.451m };
var modes = new[] { MidpointRounding.ToEven, MidpointRounding.AwayFromZero, MidpointRounding.ToZero, MidpointRounding.ToNegativeInfinity, MidpointRounding.ToPositiveInfinity };
foreach (var mode in modes)
    Console.WriteLine(mode.ToString().PadRight(18) + string.Join(" ", midpoints.Select(m => F(Math.Round(m, m == Math.Truncate(m * 10) / 10 ? 0 : 1, mode)).PadLeft(4))));
Console.WriteLine("default            " + string.Join(" ", midpoints.Select(m => F(Math.Round(m)).PadLeft(4))));
Console.WriteLine("trunc/floor/ceil   " + string.Join(" ", new[] { 2.7m, -2.7m, 2.0m, -0.1m }.Select(m => F(decimal.Truncate(m)) + "/" + F(decimal.Floor(m)) + "/" + F(decimal.Ceiling(m)))));

// Scale is preserved through arithmetic and shows up in ToString.
decimal a = 1.10m, b = 2.200m;
Console.WriteLine("scale: " + F(a + b) + " " + F(a * b) + " " + F(b - 2.2m) + " " + F(a / 4) + " " + F(1m / 3m) + " " + F(2m / 3m) + " " + F(100m / 8m) + " " + F(1.00m * 1.00m)
    + " | scales " + Scale(a) + "," + Scale(a * b) + "," + Scale(1m / 3m) + "," + Scale(decimal.Round(b, 1)) + " | equal " + (1.0m == 1.000m) + " " + F(1.000m).Equals(F(1.0m)));
Console.WriteLine("remainder: " + F(7.5m % 2m) + " " + F(-7.5m % 2m) + " " + F(7.5m % -2m) + " " + F(10m % 0.3m) + " " + F(1.25m % 0.5m) + " " + F(decimal.Remainder(123.456m, 1m))
    + " | negate " + F(-a) + " " + F(decimal.Negate(0.0m)) + " " + F(Math.Abs(-3.50m)) + " " + Math.Sign(-0.001m));

// An invoice with per-line tax, proportional discount allocation and penny reconciliation.
var lines = new List<InvoiceLine>
{
    new InvoiceLine("widget", 3, 19.99m, 0.20m), new InvoiceLine("gasket", 12, 0.335m, 0.20m), new InvoiceLine("manual", 1, 7.125m, 0.05m),
    new InvoiceLine("service", 2.5m, 45.00m, 0.20m), new InvoiceLine("refund", -1, 3.333m, 0m),
};
decimal netTotal = 0m, taxTotal = 0m;
foreach (var line in lines)
{
    decimal net = Math.Round(line.Quantity * line.UnitPrice, 2, MidpointRounding.AwayFromZero);
    decimal tax = Math.Round(net * line.TaxRate, 2, MidpointRounding.ToEven);
    netTotal += net;
    taxTotal += tax;
    Console.WriteLine(line.Name.PadRight(8) + F(line.Quantity).PadLeft(4) + " x " + F(line.UnitPrice).PadLeft(6) + " = " + F(line.Quantity * line.UnitPrice).PadLeft(8)
        + " -> " + net.ToString("0.00", CultureInfo.InvariantCulture).PadLeft(7) + " tax " + F(tax).PadLeft(5) + " (" + line.TaxRate.ToString("P0", CultureInfo.InvariantCulture) + ")");
}
Console.WriteLine("net " + F(netTotal) + " tax " + F(taxTotal) + " gross " + F(netTotal + taxTotal) + " | N2: " + (netTotal * 1000).ToString("N2", CultureInfo.InvariantCulture)
    + " C-less: " + (netTotal + taxTotal).ToString("#,##0.000", CultureInfo.InvariantCulture));

decimal discount = 10.00m;
decimal[] nets = lines.Select(l => Math.Round(l.Quantity * l.UnitPrice, 2, MidpointRounding.AwayFromZero)).ToArray();
decimal positive = nets.Where(n => n > 0).Sum();
decimal[] shares = nets.Select(n => n > 0 ? decimal.Floor(discount * n / positive * 100m) / 100m : 0m).ToArray();
decimal leftover = discount - shares.Sum();
for (int i = 0; leftover > 0m; i = (i + 1) % shares.Length)
{
    if (nets[i] <= 0) continue;
    shares[i] += 0.01m;
    leftover -= 0.01m;
}
Console.WriteLine("discount shares: " + string.Join(" ", shares.Select(F)) + " sum=" + F(shares.Sum()) + " leftover=" + F(leftover));

// Loan amortisation: the payment is rounded up, the last instalment absorbs the difference.
decimal principal = 10000m, monthlyRate = 0.06m / 12m;
int months = 6;
decimal factor = 1m;
for (int i = 0; i < months; i++) factor *= 1m + monthlyRate;
decimal payment = Math.Ceiling(principal * monthlyRate * factor / (factor - 1m) * 100m) / 100m;
decimal balance = principal, interestPaid = 0m;
Console.WriteLine("factor " + F(factor) + " payment " + F(payment));
for (int month = 1; month <= months; month++)
{
    decimal interest = Math.Round(balance * monthlyRate, 2);
    decimal due = month == months ? balance + interest : payment;
    balance -= due - interest;
    interestPaid += interest;
    Console.WriteLine("  #" + month + " due " + F(due) + " interest " + F(interest) + " balance " + F(balance));
}
Console.WriteLine("interest paid " + F(interestPaid) + " | float drift: " + (0.1 + 0.2 == 0.3) + " vs decimal " + (0.1m + 0.2m == 0.3m)
    + " | sum of 0.1 x1000: " + F(Enumerable.Repeat(0.1m, 1000).Sum()) + " / " + Enumerable.Repeat(0.1, 1000).Sum().ToString("R", CultureInfo.InvariantCulture));

// Conversions in both directions, including the ones that overflow or lose precision.
int whole = (int)1234.99m;
long big = (long)-9_999_999_999.5m;
double asDouble = (double)0.1m;
float asFloat = (float)16777217.0m;
decimal fromDouble = (decimal)0.1, fromFloat = (decimal)1.1f, fromInt = int.MinValue, fromUlong = ulong.MaxValue, fromChar = 'A';
Console.WriteLine("conv: " + whole + " " + big + " " + (byte)255.9m + " " + (sbyte)-128.9m + " " + (char)66.7m + " " + asDouble.ToString("R", CultureInfo.InvariantCulture)
    + " " + asFloat.ToString("R", CultureInfo.InvariantCulture) + " " + F(fromDouble) + " " + F(fromFloat) + " " + F(fromInt) + " " + F(fromUlong) + " " + F(fromChar)
    + " " + F((decimal)1e-5) + " " + F((decimal)123456789.123456789) + " " + F(decimal.Parse("1e3", NumberStyles.Float, CultureInfo.InvariantCulture)) + " " + F(decimal.Parse("  -4.50 ", CultureInfo.InvariantCulture)));

decimal huge = decimal.MaxValue;
string Attempt(Func<decimal> compute)
{
    try { return F(compute()); }
    catch (OverflowException) { return "overflow"; }
    catch (DivideByZeroException) { return "div0"; }
}
decimal zero = 0m, tooBigForInt = 3_000_000_000m;
Console.WriteLine("limits: " + F(huge) + " " + F(decimal.MinValue) + " " + Attempt(() => huge + 1m) + " " + Attempt(() => unchecked(huge * 2m)) + " " + Attempt(() => huge + 0.4m)
    + " " + Attempt(() => huge - 0.5m) + " " + Attempt(() => 1m / zero) + " " + Attempt(() => zero % zero) + " " + Attempt(() => unchecked((int)tooBigForInt))
    + " " + Attempt(() => (decimal)(asDouble * 1e300)) + " " + Attempt(() => (uint)tooBigForInt) + " " + Attempt(() => (decimal)1e-30) + " " + F(0.0000000000000000000000000001m / 10m));
Console.WriteLine("compare: " + (1.5m > 1.49999m) + " " + 2.50m.CompareTo(2.5m) + " " + decimal.Compare(-1m, 1m) + " " + F(Math.Max(1.10m, 1.1m)) + " " + F(Math.Min(-0.0m, 0m))
    + " " + F(decimal.MinusOne * decimal.One) + " " + F(Math.Clamp(15.75m, 0m, 9.99m)) + " " + (decimal.Zero == -0.00m) + " " + new[] { 1.50m, 1.5m, 1.500m }.Distinct().Count());

public sealed record InvoiceLine(string Name, decimal Quantity, decimal UnitPrice, decimal TaxRate);
