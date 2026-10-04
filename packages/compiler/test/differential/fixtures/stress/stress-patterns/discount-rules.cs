using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public enum Tier { Guest, Silver, Gold, Staff }
public enum Category { Food, Books, Electronics, Alcohol, Service }

public sealed class Address
{
    public string Country { get; init; }
    public string Region { get; init; }
}

public sealed class Customer
{
    public string Name { get; init; }
    public Tier Tier { get; init; }
    public Address Address { get; init; }
    public int? LoyaltyYears { get; init; }
    public bool TaxExempt { get; init; }
}

public readonly struct LineItem
{
    public LineItem(string sku, Category category, decimal price, int quantity) { Sku = sku; Category = category; Price = price; Quantity = quantity; }
    public string Sku { get; }
    public Category Category { get; }
    public decimal Price { get; }
    public int Quantity { get; }
    public void Deconstruct(out Category category, out decimal price, out int quantity) { category = Category; price = Price; quantity = Quantity; }
}

public readonly struct Coupon
{
    public string Code { get; init; }
    public decimal? Percent { get; init; }
    public decimal? Flat { get; init; }
}

public static class Rules
{
    public static decimal TaxRate(Customer customer, Category category) => (customer, category) switch
    {
        ({ TaxExempt: true }, _) => 0m,
        ({ Address: null }, _) => 0.25m,
        ({ Address.Country: "DE" }, Category.Food or Category.Books) => 0.07m,
        ({ Address.Country: "DE" }, _) => 0.19m,
        ({ Address: { Country: "US", Region: "OR" or "MT" or "NH" } }, _) => 0m,
        ({ Address: { Country: "US", Region: var region } }, not Category.Food) => region is "CA" ? 0.0725m : 0.06m,
        ({ Address.Country: "US" }, Category.Food) => 0m,
        ({ Address.Country: "PL" }, var kind) => kind switch { Category.Books => 0.05m, Category.Food => 0.08m, _ => 0.23m },
        (_, Category.Service) => 0m,
        _ => 0.2m,
    };

    public static decimal LineDiscount(Tier tier, LineItem item) => (tier, item) switch
    {
        (_, (Category.Alcohol, _, _)) => 0m,
        (Tier.Staff, (not Category.Service, var price, _)) => price >= 500m ? 0.2m : 0.3m,
        (Tier.Gold, (_, _, >= 10)) => 0.15m,
        (Tier.Gold or Tier.Silver, (Category.Books, _, > 2 and var quantity)) => Math.Min(0.05m + 0.01m * quantity, 0.12m),
        (Tier.Gold, _) => 0.05m,
        (Tier.Silver, { Price: > 100m, Quantity: 1 }) => 0.03m,
        (Tier.Guest, (_, < 1m, >= 100) bulk) => bulk.Quantity >= 1000 ? 0.1m : 0.02m,
        _ => 0m,
    };

    public static decimal LoyaltyBonus(Customer customer)
    {
        if (customer is not { LoyaltyYears: { } years } || years < 0) return 0m;
        return years switch
        {
            0 => 0m,
            >= 1 and < 5 => 0.01m * years,
            >= 5 and <= 10 when customer.Tier is Tier.Gold or Tier.Staff => 0.08m,
            >= 5 and <= 10 => 0.05m,
            _ => 0.1m,
        };
    }

    public static decimal ApplyCoupon(decimal subtotal, Coupon? coupon, out string note)
    {
        switch (coupon)
        {
            case null:
                note = "no coupon";
                return subtotal;
            case { Percent: not null, Flat: not null } or { Code: null or "" }:
                note = "invalid coupon";
                return subtotal;
            case { Percent: > 0m and <= 50m and var percent, Code: var code }:
                note = code + " -" + percent.ToString("0.#", CultureInfo.InvariantCulture) + "%";
                return subtotal * (1 - percent / 100m);
            case { Percent: { } rejected }:
                note = "percent out of range: " + rejected.ToString("0.#", CultureInfo.InvariantCulture);
                return subtotal;
            case { Flat: decimal flat } when flat > 0 && flat < subtotal:
                note = "flat -" + flat.ToString("0.00", CultureInfo.InvariantCulture);
                return subtotal - flat;
            case { Flat: > 0m }:
                note = "flat exceeds subtotal";
                return 0m;
            case { Code: ['F', 'R', 'E', 'E', .. var suffix] } when subtotal is >= 20m and < 1000m:
                note = "free shipping token " + suffix;
                return subtotal;
            default:
                note = "coupon ignored";
                return subtotal;
        }
    }

    public static decimal Shipping(decimal subtotal, double? weightKg, string country) => (subtotal, weightKg, country) switch
    {
        (_, null, _) => 0m,
        (>= 200m, _, "DE" or "PL" or "FR") => 0m,
        (_, <= 0.5, _) => 2.5m,
        (_, > 0.5 and <= 5, "US") => 9m,
        (_, > 0.5 and <= 5, _) => 6m,
        (< 50m, double heavy, not "US") => 6m + (decimal)Math.Ceiling(heavy - 5) * 1.5m,
        (_, double heavy, _) => 12m + (decimal)Math.Floor(heavy / 10) * 4m,
    };
}

public static class Program
{
    private static string M(decimal value) => value.ToString("0.00", CultureInfo.InvariantCulture);

    public static void Main()
    {
        var customers = new[]
        {
            new Customer { Name = "Anna", Tier = Tier.Gold, Address = new Address { Country = "DE" }, LoyaltyYears = 7 },
            new Customer { Name = "Bob", Tier = Tier.Silver, Address = new Address { Country = "US", Region = "CA" }, LoyaltyYears = 2 },
            new Customer { Name = "Cy", Tier = Tier.Guest, Address = new Address { Country = "US", Region = "OR" } },
            new Customer { Name = "Dana", Tier = Tier.Staff, Address = new Address { Country = "PL" }, LoyaltyYears = 12 },
            new Customer { Name = "Eve", Tier = Tier.Guest, LoyaltyYears = 0 },
            new Customer { Name = "Faye", Tier = Tier.Silver, Address = new Address { Country = "JP" }, TaxExempt = true, LoyaltyYears = 6 },
        };
        var basket = new[]
        {
            new LineItem("bread", Category.Food, 0.8m, 120), new LineItem("novel", Category.Books, 12.5m, 4), new LineItem("laptop", Category.Electronics, 999m, 1),
            new LineItem("wine", Category.Alcohol, 15m, 12), new LineItem("repair", Category.Service, 60m, 1), new LineItem("cable", Category.Electronics, 4m, 10),
        };
        Coupon?[] coupons = { null, new Coupon { Code = "SPRING", Percent = 10 }, new Coupon { Code = "BOTH", Percent = 5, Flat = 5 }, new Coupon { Code = "BIG", Percent = 80 },
            new Coupon { Code = "TENOFF", Flat = 10 }, new Coupon { Code = "FREESHIP" } };
        double?[] weights = { 0.3, 3, 14, null, 42.5, 5.5 };

        for (int i = 0; i < customers.Length; i++)
        {
            var customer = customers[i];
            decimal net = 0, tax = 0;
            var parts = new List<string>();
            foreach (var item in basket)
            {
                decimal discount = Math.Min(Rules.LineDiscount(customer.Tier, item) + Rules.LoyaltyBonus(customer), 0.35m);
                decimal line = Math.Round(item.Price * item.Quantity * (1 - discount), 2);
                decimal rate = Rules.TaxRate(customer, item.Category);
                net += line;
                tax += Math.Round(line * rate, 2);
                if (discount is > 0m and var applied) parts.Add(item.Sku + ":" + (applied * 100).ToString("0.#", CultureInfo.InvariantCulture) + "%");
            }
            decimal afterCoupon = Rules.ApplyCoupon(net, coupons[i], out string note);
            string country = customer is { Address.Country: var c } ? c : "??";
            decimal shipping = Rules.Shipping(afterCoupon, weights[i], country);
            Console.WriteLine($"{customer.Name} [{country}] net {M(net)} tax {M(tax)} coupon({note}) -> {M(afterCoupon)} ship {M(shipping)} total {M(afterCoupon + tax + shipping)}");
            Console.WriteLine("  discounts: " + (parts is [] ? "none" : string.Join(" ", parts)));
        }

        Console.WriteLine(string.Join(" ", customers.Select(x => x.Name + "=" + M(Rules.LoyaltyBonus(x)))) + " null=" + M(Rules.LoyaltyBonus(null)));
        Console.WriteLine(string.Join(" ", new[] { Category.Food, Category.Service, Category.Alcohol }.Select(k => k + ":" + Rules.TaxRate(null, k).ToString(CultureInfo.InvariantCulture))));
        foreach (var subtotal in new[] { 5m, 25m, 2000m })
        {
            var notes = new List<string>();
            foreach (var coupon in coupons)
            {
                decimal result = Rules.ApplyCoupon(subtotal, coupon, out var why);
                notes.Add(result == subtotal ? why : why + "=" + M(result));
            }
            Console.WriteLine(M(subtotal) + ": " + string.Join(" | ", notes.Distinct()));
        }
        Console.WriteLine(string.Join(" ", new (decimal, double?, string)[] { (250m, 20, "FR"), (250m, 20, "US"), (10m, 7.2, "PL"), (10m, 7.2, "US"), (60m, 0.5, "DE"), (60m, 0.51, "US") }
            .Select(t => M(Rules.Shipping(t.Item1, t.Item2, t.Item3)))));
    }
}
