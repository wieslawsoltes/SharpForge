using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

var customers = new List<Customer>
{
    new Customer(1, "Acme", "US"), new Customer(2, "Globex", "DE"), new Customer(3, "Initech", "US"), new Customer(4, "Umbrella", "JP"),
};
var products = new[]
{
    new Product("KB-01", "Keyboard", 49.90m), new Product("MS-02", "Mouse", 19.50m), new Product("MN-03", "Monitor", 219.00m), new Product("CB-04", "Cable", 4.25m),
};
var orders = new[]
{
    new Order(100, 1, 2024, 1), new Order(101, 3, 2024, 1), new Order(102, 1, 2024, 2), new Order(103, 9, 2024, 2), new Order(104, 2, 2025, 1),
};
var lines = new[]
{
    new OrderLine(100, "kb-01", 2), new OrderLine(100, "MS-02", 2), new OrderLine(101, "MN-03", 1), new OrderLine(102, "CB-04", 10),
    new OrderLine(102, "mn-03", 2), new OrderLine(104, "KB-01", 5), new OrderLine(104, "XX-99", 1), new OrderLine(103, "MS-02", 3),
};
var targets = new[] { (Year: 2024, Quarter: 1, Goal: 300m), (Year: 2024, Quarter: 2, Goal: 400m), (Year: 2025, Quarter: 2, Goal: 100m) };

string Money(decimal value) => value.ToString("#,##0.00", CultureInfo.InvariantCulture);

Console.WriteLine("-- inner join (method syntax)");
var placed = orders.Join(customers, o => o.CustomerId, c => c.Id, (o, c) => new { o.Id, c.Name, c.Country });
foreach (var row in placed) Console.WriteLine($"{row.Id} {row.Name} ({row.Country})");

Console.WriteLine("-- join with custom key comparer");
var priced = lines.Join(products, l => l.Sku, p => p.Sku, (l, p) => (l.OrderId, p.Title, Total: l.Quantity * p.Price), StringComparer.OrdinalIgnoreCase).ToList();
foreach (var (orderId, title, total) in priced) Console.WriteLine($"{orderId} {title,-9}{Money(total),10}");
Console.WriteLine("case-sensitive matches: " + lines.Join(products, l => l.Sku, p => p.Sku, (l, p) => l.OrderId).Count());

Console.WriteLine("-- group join");
var perCustomer = customers.GroupJoin(orders, c => c.Id, o => o.CustomerId, (c, own) => new { c.Name, Orders = own.Select(o => o.Id).ToArray() });
foreach (var row in perCustomer) Console.WriteLine($"{row.Name}: {row.Orders.Length} [{string.Join(",", row.Orders)}]");

Console.WriteLine("-- left outer join via GroupJoin + SelectMany + DefaultIfEmpty");
var outer = orders
    .GroupJoin(customers, o => o.CustomerId, c => c.Id, (o, matches) => new { Order = o, matches })
    .SelectMany(x => x.matches.DefaultIfEmpty(), (x, c) => $"{x.Order.Id}->{(c == null ? "?" : c.Name)}");
Console.WriteLine(string.Join(" ", outer));
var leftLines = lines.GroupJoin(products, l => l.Sku, p => p.Sku, (l, ps) => (Line: l, Product: ps.FirstOrDefault()), new SkuComparer());
Console.WriteLine(string.Join(" ", leftLines.Where(x => x.Product is null).Select(x => "unknown:" + x.Line.Sku)));

Console.WriteLine("-- LeftJoin / RightJoin");
Console.WriteLine(string.Join(" ", customers.LeftJoin(orders, c => c.Id, o => o.CustomerId, (c, o) => c.Name[0] + ":" + (o == null ? "none" : o.Id.ToString(CultureInfo.InvariantCulture)))));
Console.WriteLine(string.Join(" ", customers.RightJoin(orders, c => c.Id, o => o.CustomerId, (c, o) => o.Id + ":" + (c?.Country ?? "--"))));

Console.WriteLine("-- composite keys");
var revenue = from o in orders
              join l in lines on o.Id equals l.OrderId
              join p in products on l.Sku.ToUpperInvariant() equals p.Sku
              group l.Quantity * p.Price by new { o.Year, o.Quarter } into g
              select new { g.Key.Year, g.Key.Quarter, Revenue = g.Sum() };
var versusGoal = from t in targets
                 join r in revenue on new { t.Year, t.Quarter } equals new { r.Year, r.Quarter } into hits
                 from hit in hits.DefaultIfEmpty()
                 let actual = hit == null ? 0m : hit.Revenue
                 select $"{t.Year}Q{t.Quarter}: goal {Money(t.Goal)} actual {Money(actual)} {(actual >= t.Goal ? "MET" : "missed by " + Money(t.Goal - actual))}";
foreach (string row in versusGoal) Console.WriteLine(row);
var tupleJoin = orders.Join(targets, o => (o.Year, o.Quarter), t => (t.Year, t.Quarter), (o, t) => o.Id + "/" + Money(t.Goal));
Console.WriteLine(string.Join(" ", tupleJoin));

Console.WriteLine("-- query join ... into with aggregates");
var basket = from o in orders
             join l in lines on o.Id equals l.OrderId into own
             join c in customers on o.CustomerId equals c.Id into owner
             let total = (from l in own join p in products on l.Sku equals p.Sku select l.Quantity * p.Price).Sum()
             orderby total descending, o.Id
             select new { o.Id, Who = owner.Select(c => c.Name).SingleOrDefault() ?? "(orphan)", Items = own.Sum(l => l.Quantity), total };
foreach (var b in basket) Console.WriteLine($"{b.Id} {b.Who,-9} items={b.Items,2} exact-sku total={Money(b.total),8}");

Console.WriteLine("-- self join and cross join");
var sameCountry = from a in customers
                  join b in customers on a.Country equals b.Country
                  where a.Id < b.Id
                  select a.Name + "~" + b.Name;
Console.WriteLine(string.Join(" ", sameCountry));
var cheaper = from a in products
              from b in products
              where a.Price * 4 < b.Price
              select a.Title[0].ToString() + b.Title[0];
Console.WriteLine(string.Join(" ", cheaper) + " " + products.Join(products, a => a.Title.Length, b => b.Title.Length, (a, b) => 1).Sum());
Dictionary<int, Customer> byId = customers.ToDictionary(c => c.Id);
Console.WriteLine(string.Join(" ", orders.Select(o => byId.TryGetValue(o.CustomerId, out Customer found) ? found.Country : "??")));

public sealed record Customer(int Id, string Name, string Country);
public sealed record Product(string Sku, string Title, decimal Price);
public sealed record Order(int Id, int CustomerId, int Year, int Quarter);
public readonly record struct OrderLine(int OrderId, string Sku, int Quantity);

public sealed class SkuComparer : IEqualityComparer<string>
{
    public bool Equals(string x, string y) => string.Equals(x, y, StringComparison.OrdinalIgnoreCase);
    public int GetHashCode(string obj) => obj.Length;
}
