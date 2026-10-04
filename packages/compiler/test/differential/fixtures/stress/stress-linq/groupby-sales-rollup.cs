using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace SalesRollup
{
    public enum Channel { Web, Store, Partner }

    public sealed class Sale
    {
        public Sale(string region, string product, Channel channel, int quarter, int units, decimal price)
        {
            Region = region; Product = product; Channel = channel; Quarter = quarter; Units = units; Price = price;
        }

        public string Region { get; }
        public string Product { get; }
        public Channel Channel { get; }
        public int Quarter { get; }
        public int Units { get; }
        public decimal Price { get; }
        public decimal Revenue => Units * Price;
    }

    public sealed class ChannelSummary
    {
        public Channel Channel { get; init; }
        public int Deals { get; init; }
        public decimal Revenue { get; init; }
        public string TopProduct { get; init; }
        public override string ToString() => $"{Channel,-8}{Deals,2} deals {Program.Money(Revenue),8} top={TopProduct}";
    }

    public static class Program
    {
        private static readonly Sale[] Sales =
        {
            new Sale("North", "Widget", Channel.Web, 1, 10, 2.50m),
            new Sale("north", "Gadget", Channel.Store, 1, 3, 19.99m),
            new Sale("South", "Widget", Channel.Store, 1, 7, 2.75m),
            new Sale("East", "Gizmo", Channel.Partner, 2, 1, 105.00m),
            new Sale("South", "Gadget", Channel.Web, 2, 4, 18.50m),
            new Sale("North", "Widget", Channel.Web, 2, 12, 2.40m),
            new Sale("East", "Widget", Channel.Store, 3, 20, 2.25m),
            new Sale("South", "Gizmo", Channel.Partner, 3, 2, 99.00m),
            new Sale("NORTH", "Gadget", Channel.Web, 4, 5, 21.00m),
            new Sale("East", "Gadget", Channel.Store, 4, 6, 17.25m),
        };

        public static string Money(decimal value) => value.ToString("0.00", CultureInfo.InvariantCulture);

        private static void Section(string title) => Console.WriteLine("-- " + title);

        public static void Main()
        {
            Section("key only (ordinal vs ignore-case)");
            foreach (IGrouping<string, Sale> group in Sales.GroupBy(s => s.Region))
                Console.WriteLine($"{group.Key}: {group.Count()} sales, {Money(group.Sum(s => s.Revenue))}");
            foreach (var group in Sales.GroupBy(s => s.Region, StringComparer.OrdinalIgnoreCase))
                Console.WriteLine($"{group.Key.ToUpperInvariant()}: {string.Join(",", group.Select(s => s.Units))}");

            Section("key + element selector");
            IEnumerable<IGrouping<string, int>> unitsByProduct = Sales.GroupBy(s => s.Product, s => s.Units);
            foreach (var group in unitsByProduct)
                Console.WriteLine(group.Key + " " + string.Join("+", group) + "=" + group.Sum() + " max " + group.Max());

            Section("key + result selector");
            var summaries = Sales.GroupBy(s => s.Channel, (channel, items) => new ChannelSummary
            {
                Channel = channel,
                Deals = items.Count(),
                Revenue = items.Sum(i => i.Revenue),
                TopProduct = items.GroupBy(i => i.Product).OrderByDescending(p => p.Sum(i => i.Revenue)).First().Key,
            });
            foreach (ChannelSummary summary in summaries.OrderByDescending(s => s.Revenue)) Console.WriteLine(summary);

            Section("key + element + result selector");
            var quarters = Sales.GroupBy(s => s.Quarter, s => s.Revenue, (quarter, revenues) => (Quarter: quarter, Total: revenues.Sum(), Best: revenues.Max(), Count: revenues.Count()));
            foreach (var (quarter, total, best, count) in quarters.OrderBy(q => q.Quarter))
                Console.WriteLine($"Q{quarter}: total {Money(total)} best {Money(best)} avg {Money(total / count)}");

            Section("tuple composite key");
            var byRegionQuarter = Sales.GroupBy(s => (Region: s.Region.ToLowerInvariant(), Half: (s.Quarter + 1) / 2))
                .OrderBy(g => g.Key.Region, StringComparer.Ordinal).ThenBy(g => g.Key.Half);
            foreach (var group in byRegionQuarter)
                Console.WriteLine($"{group.Key.Region}/H{group.Key.Half}: {group.Sum(s => s.Units)} units over {group.Select(s => s.Product).Distinct().Count()} products");

            Section("anonymous composite key");
            var repeats = Sales.GroupBy(s => new { s.Product, s.Channel }).Where(g => g.Count() > 1).Select(g => new { g.Key.Product, g.Key.Channel, Units = g.Sum(s => s.Units) });
            foreach (var repeat in repeats) Console.WriteLine($"{repeat.Product} via {repeat.Channel}: {repeat.Units}");
            Console.WriteLine(new { Product = "Widget", Channel = Channel.Web }.Equals(Sales.GroupBy(s => new { s.Product, s.Channel }).First().Key));

            Section("nested groups");
            var nested = from sale in Sales
                         group sale by sale.Region.ToLowerInvariant() into region
                         orderby region.Sum(s => s.Revenue) descending
                         select new
                         {
                             Region = region.Key,
                             Products = from s in region
                                        group s.Revenue by s.Product into product
                                        orderby product.Sum() descending
                                        select product.Key + "=" + Money(product.Sum()),
                         };
            foreach (var region in nested) Console.WriteLine(region.Region + ": " + string.Join(", ", region.Products));

            Section("lookup and dictionary");
            ILookup<Channel, string> lookup = Sales.ToLookup(s => s.Channel, s => s.Product[0] + s.Quarter.ToString(CultureInfo.InvariantCulture));
            foreach (Channel channel in Enum.GetValues<Channel>())
                Console.WriteLine($"{channel}: [{string.Join(" ", lookup[channel])}] contains={lookup.Contains(channel)}");
            Console.WriteLine("missing key yields " + lookup[(Channel)42].Count() + " items, lookup has " + lookup.Count + " keys");
            Dictionary<string, decimal> revenueByProduct = Sales.GroupBy(s => s.Product).ToDictionary(g => g.Key, g => g.Sum(s => s.Revenue));
            foreach (KeyValuePair<string, decimal> pair in revenueByProduct.OrderBy(p => p.Value))
                Console.WriteLine($"{pair.Key,-7}{Money(pair.Value),9}");

            Section("CountBy / AggregateBy");
            Console.WriteLine(string.Join(" ", Sales.CountBy(s => s.Quarter % 2 == 0 ? "even" : "odd").Select(p => p.Key + ":" + p.Value)));
            var bestPrice = Sales.AggregateBy(s => s.Product, decimal.MaxValue, (lowest, s) => Math.Min(lowest, s.Price));
            Console.WriteLine(string.Join(" ", bestPrice.Select(p => p.Key + "@" + Money(p.Value))));
            var share = Sales.GroupBy(s => s.Channel).Select(g => g.Sum(s => s.Revenue) / Sales.Sum(s => s.Revenue));
            Console.WriteLine(string.Join(" ", share.Select(x => x.ToString("P1", CultureInfo.InvariantCulture))));
        }
    }
}
