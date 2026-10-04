global using System;
global using System.Collections.Generic;
global using Text = System.Text.StringBuilder;
global using static System.Math;
using System.Linq;
using Inventory.Model;
using Money = System.Decimal;

namespace Inventory.Model
{
    public partial class Product
    {
        public Product(string name, Money price) { Name = name; Price = price; OnCreated(); }
        public string Name { get; }
        public Money Price { get; private set; }
        partial void OnCreated();
        partial void OnPriceChanging(Money oldPrice, ref Money newPrice);
        public partial string Describe();
    }

    public partial class Product : IComparable<Product>
    {
        public static int Created;
        partial void OnCreated() { Created++; }
        partial void OnPriceChanging(Money oldPrice, ref Money newPrice) { if (newPrice < 0) newPrice = 0; }
        public partial string Describe() => Name + "@" + Price;
        public void Reprice(Money price)
        {
            OnPriceChanging(Price, ref price);
            Price = price;
        }
        public int CompareTo(Product other) => Price.CompareTo(other.Price);

        public partial struct Tag { public string Label; public int Weight; }
    }

    public partial class Product
    {
        public partial struct Tag
        {
            public override string ToString() => Label + ":" + Weight;
        }
        public List<Tag> Tags { get; } = new List<Tag>();
    }

    namespace Units
    {
        public enum Unit { Piece, Kilogram, Litre }
        public static class UnitExtensions
        {
            public static string Symbol(this Unit unit) => unit switch { Unit.Kilogram => "kg", Unit.Litre => "l", _ => "pc" };
        }
    }
}

namespace Inventory
{
    using Model.Units;

    public static partial class Warehouse
    {
        private static readonly Dictionary<string, (Product Product, int Quantity, Unit Unit)> stock = new();

        public static void Receive(Product product, int quantity, Unit unit = Unit.Piece)
        {
            stock[product.Name] = stock.TryGetValue(product.Name, out var entry) ? (entry.Product, entry.Quantity + quantity, entry.Unit) : (product, quantity, unit);
        }
    }

    public static partial class Warehouse
    {
        public static Money Value => stock.Values.Sum(entry => entry.Product.Price * entry.Quantity);
        public static string Report()
        {
            var text = new Text();
            foreach (var (product, quantity, unit) in stock.Values.OrderBy(entry => entry.Product))
                text.Append(product.Describe()).Append(" x").Append(quantity).Append(unit.Symbol()).Append("; ");
            return text.ToString().TrimEnd();
        }
    }
}

namespace Inventory.Model.Units.Conversions
{
    public static class Converter
    {
        public static double ToGrams(this Unit unit, double amount) => unit == Unit.Kilogram ? amount * 1000 : throw new InvalidOperationException(unit + " has no mass");
    }
}

namespace App
{
    using Inventory;
    using Inventory.Model.Units;
    using Inventory.Model.Units.Conversions;
    using static Inventory.Warehouse;
    using Tag = Inventory.Model.Product.Tag;

    internal static class Program
    {
        private static void Main()
        {
            var apple = new Product("apple", 0.5m);
            var cheese = new Product("cheese", 12.75m);
            var milk = new global::Inventory.Model.Product("milk", 1.2m);
            Receive(apple, 100);
            Receive(cheese, 3, Unit.Kilogram);
            Receive(milk, 10, unit: Unit.Litre);
            Receive(apple, 20);
            cheese.Reprice(-5);
            milk.Reprice(1.35m);
            cheese.Tags.Add(new Tag { Label = "dairy", Weight = 2 });
            cheese.Tags.Add(new Tag { Label = "aged" });
            Console.WriteLine(Report());
            Console.WriteLine(Warehouse.Value + " " + Product.Created + " " + string.Join(",", cheese.Tags));
            Console.WriteLine(Unit.Kilogram.ToGrams(2.5) + " " + Max(Abs(-3), 2) + " " + Round(Sqrt(2), 3) + " " + Floor(-1.5) + " " + PI.ToString("F5"));
            try { Unit.Piece.ToGrams(1); }
            catch (InvalidOperationException e) { Console.WriteLine(e.Message); }
            Text text = new();
            text.Append(nameof(Inventory.Model.Units.Unit)).Append('/').Append(nameof(Warehouse.Report)).Append('/').Append(typeof(Tag).FullName);
            Console.WriteLine(text);
        }
    }
}
