using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;

namespace Shop;

public abstract class Entity(int id)
{
    public int Id { get; } = id;
    public override string ToString() => $"{GetType().Name}#{Id}";
}

public class Product(int id, string name, int cents) : Entity(id)
{
    public string Name { get; set => field = string.IsNullOrWhiteSpace(value) ? throw new ArgumentException("blank", nameof(Name)) : value.Trim(); } = name;
    public int Cents { get => field; set { if (value < 0) throw new ArgumentOutOfRangeException(nameof(Cents)); field = value - value % 5; } } = cents;
    public int Stock { get; private set; }
    public string Slug => field ??= Name.ToLowerInvariant().Replace(' ', '-') + "-" + Id;
    public int Changes { get; private set; }
    public List<string> Tags { get; set; }
    public void Restock(int quantity) { Stock += quantity; Changes++; }
}

public sealed class Perishable(int id, string name, int cents, int shelfDays) : Product(id, name, cents)
{
    public int DaysLeft(int age) => shelfDays - age;
    public void Age(int days) => shelfDays = Math.Max(0, shelfDays - days);
    public bool Expired => shelfDays == 0;
}

public class Sequence(int start, int step = 1)
{
    public int Next() { int current = start; start += step; return current; }
    public int Peek => start;
    public Func<int> Skipper(int count) => () => start += step * count;
}

public readonly struct Money(int cents, string currency = "EUR")
{
    public int Cents => cents;
    public string Currency => currency ?? "EUR";
    public override string ToString() => $"{cents / 100}.{Math.Abs(cents % 100):00} {Currency}";
}

public struct Span2(int low, int high)
{
    public int Low = Math.Min(low, high);
    public int High = Math.Max(low, high);
    public readonly int Length => High - Low;
}

public sealed class OrderLine
{
    public required Product Product { get; init; }
    public int Quantity { get; set; } = 1;
}

public sealed class Order
{
    public required int Number { get; init; }
    public string Customer { get; init; } = "walk-in";
    public List<OrderLine> Lines { get; init; } = [];
    public string Note { get; set; }
    public int[] Ratings { get; set; }
    public Order Parent { get; set; }
}

public static class ShopExtensions
{
    extension(Product product)
    {
        public bool InStock => product.Stock > 0;
        public Money Price => new(product.Cents);
        public string Label(bool withStock = false) => product.Name + " @ " + product.Price + (withStock ? " x" + product.Stock : "");
        public static Product Sample => new(0, " sample ", 199);
        public static Product Parse(string text) => text.Split(':') is [var id, var name, var cents] ? new Product(int.Parse(id), name, int.Parse(cents)) : null;
    }

    extension(Money)
    {
        public static Money Zero => new(0);
        public static Money operator +(Money left, Money right) => new(left.Cents + right.Cents, left.Currency);
        public static Money operator *(Money left, int factor) => new(left.Cents * factor, left.Currency);
    }

    extension<T>(IEnumerable<T> source)
    {
        public bool IsEmpty => !source.Any();
        public IEnumerable<T> EveryOther()
        {
            bool take = true;
            foreach (var item in source) { if (take) yield return item; take = !take; }
        }
        public static IEnumerable<T> Twice(T item) => [item, item];
    }

    extension<T>(T value) where T : INumber<T>
    {
        public T Squared => value * value;
        public bool IsBetween(T low, T high) => value >= low && value <= high;
    }

    extension(Order order)
    {
        public Money Total => order.Lines.Aggregate(Money.Zero, (sum, line) => sum + line.Product.Price * line.Quantity);
        public int Depth => order.Parent is null ? 0 : 1 + order.Parent.Depth;
    }

    public static string Shout(this string text) => text.ToUpperInvariant() + "!";
    public static T Tap<T>(this T value, Action<T> action) { action(value); return value; }
}

public static class Program
{
    private static int _effects;
    private static string Effect(string value) { _effects++; return value; }

    public static void Main()
    {
        var tea = new Product(1, "  Green Tea ", 1299);
        var milk = new Perishable(2, "Milk", 89, shelfDays: 5) { Tags = ["dairy"] };
        tea.Restock(3);
        tea.Cents += 13;
        Console.WriteLine($"{tea} '{tea.Name}' {tea.Cents} {tea.Slug} {tea.InStock} {tea.Label(true)} | {milk} {milk.Cents} {milk.InStock} {milk.Label()} {milk.DaysLeft(2)}");
        milk.Age(3);
        milk.Age(4);
        tea.Name = " Jasmine Tea";
        Console.WriteLine($"{milk.Expired} {milk.DaysLeft(0)} {tea.Name} {tea.Slug} {Product.Sample.Name}/{Product.Sample.Price} {Product.Parse("7:Honey:650").Label()} {Product.Parse("bad") is null}");
        foreach (var attempt in new Action[] { () => tea.Name = "  ", () => tea.Cents = -1, () => _ = new Product(9, null, 1) })
        {
            try { attempt(); Console.WriteLine("accepted"); }
            catch (ArgumentException e) { Console.WriteLine(e.GetType().Name + " " + e.ParamName); }
        }

        Product[] catalog = [tea, milk, Product.Sample, Product.Parse("7:Honey:650").Tap(p => p.Restock(2))];
        foreach (var item in catalog.OrderBy(p => p.Cents)) Console.WriteLine($"{item,-14} {item.Label(item.InStock)} [{item.Slug}] {item.Price * 3} changes={item.Changes}");
        Console.WriteLine(string.Join(" ", catalog.EveryOther().Select(p => p.Id)) + " " + catalog.Where(p => p is Perishable).IsEmpty + " " + catalog.Sum(p => p.Stock.Squared));

        var ids = new Sequence(100, 10);
        var skip = ids.Skipper(3);
        Console.WriteLine($"{ids.Next()} {ids.Next()} {skip()} {ids.Peek} {ids.Next()} {new Sequence(5).Tap(s => s.Next()).Peek} {default(Money)} {new Money(-250, "USD")} {new Span2(9, 4).Low} {new Span2(9, 4).Length} {default(Span2).High}");

        var order = new Order { Number = ids.Next(), Lines = [new() { Product = tea, Quantity = 2 }, new OrderLine { Product = milk }] };
        Order missing = null;
        order?.Note = Effect("gift");
        missing?.Note = Effect("never");
        order?.Lines[0].Quantity += 3;
        missing?.Lines[0].Quantity += 3;
        order.Ratings?[0] = 5;
        order.Ratings ??= [1, 2, 3];
        order.Ratings?[^1] *= 10;
        order.Parent?.Parent = order;
        (order.Parent ??= new Order { Number = 1, Customer = "root" })?.Note ??= Effect("parent note");
        milk?.Tags?.Add(Effect("cold"));
        tea.Tags?.Add(Effect("unused"));
        tea?.Tags ??= [Effect("loose")];
        Console.WriteLine($"{order.Number} {order.Customer} {order.Note} {order.Lines[0].Quantity} {string.Join(",", order.Ratings)} {order.Parent.Note} {order.Depth} {_effects} {string.Join("+", milk.Tags)} {string.Join("+", tea.Tags)} {missing?.Note ?? "none"}");
        Console.WriteLine(string.Join(" ; ", order.Lines.Select(line => line.Product.Label() + " * " + line.Quantity + " = " + line.Product.Price * line.Quantity)));
        Console.WriteLine($"{order.Total} {order.Parent.Total} {Money.Zero + new Money(5) * 7} {order.Lines.IsEmpty} {order.Parent.Lines.IsEmpty} {string.Join("", "abcdefg".EveryOther())} {string.Join(",", IEnumerable<int>.Twice(4))}");
        Console.WriteLine($"{7.Squared} {1.5.Squared == 2.25} {12L.IsBetween(10, 20)} {((byte)200).IsBetween((byte)0, (byte)100)} {((byte)20).Squared} {"done".Shout()} {ShopExtensions.get_InStock(milk)} {ShopExtensions.Label(tea)} {new[] { 3, 4 }.Sum(n => n.Squared)}");
    }
}
