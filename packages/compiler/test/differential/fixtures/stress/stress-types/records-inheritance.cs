using System;
using System.Collections.Generic;
using System.Linq;

public abstract record Animal(string Name, int Legs)
{
    public abstract string Sound { get; }
    public virtual string Greet() => $"{Name} says {Sound}";
    public string Tag { get; init; } = "untagged";
}

public record Dog(string Name, string Breed) : Animal(Name, 4)
{
    public override string Sound => "woof";
}

public sealed record Puppy(string Name, string Breed, int Weeks) : Dog(Name, Breed)
{
    public override string Sound => Weeks < 8 ? "yip" : base.Sound;
    public override string Greet() => base.Greet() + "!";
}

public record Bird(string Name, bool Flies) : Animal(Name, 2)
{
    public override string Sound => "tweet";
    protected override bool PrintMembers(System.Text.StringBuilder builder)
    {
        builder.Append("Bird ").Append(Name).Append(Flies ? " (flying)" : " (grounded)");
        return true;
    }
}

public record struct Money(decimal Amount, string Currency)
{
    public static Money operator +(Money a, Money b) => a.Currency == b.Currency ? new Money(a.Amount + b.Amount, a.Currency) : throw new InvalidOperationException("currency");
    public readonly Money Rounded() => this with { Amount = Math.Round(Amount, 1) };
}

public readonly record struct Coordinate(int X, int Y)
{
    public static Coordinate Origin { get; } = new(0, 0);
    public int Manhattan => Math.Abs(X) + Math.Abs(Y);
    public Coordinate Move(int dx, int dy) => new(X + dx, Y + dy);
}

public record Order(int Id, IReadOnlyList<string> Items)
{
    public Order(int id, params string[] items) : this(id, (IReadOnlyList<string>)items) { }
    public virtual bool Equals(Order other) => other is not null && Id == other.Id && Items.SequenceEqual(other.Items);
    public override int GetHashCode() => Id;
    public int Count => Items.Count;
}

public record Person
{
    public required string First { get; init; }
    public required string Last { get; init; }
    public int Age { get; init; }
    public string Full => First + " " + Last;
    public void Deconstruct(out string first, out string last) { first = First; last = Last; }
}

public static class Program
{
    private static string Classify(Animal animal) => animal switch
    {
        Puppy { Weeks: < 8 } p => "young puppy " + p.Name,
        Puppy p => "puppy " + p.Name,
        Dog(var name, "collie") => "collie " + name,
        Dog { Breed: var breed } => "dog of breed " + breed,
        Bird { Flies: false } => "flightless",
        { Legs: 2 } => "biped",
        _ => "other",
    };

    public static void Main()
    {
        var rex = new Dog("Rex", "collie");
        var copy = rex with { };
        var renamed = rex with { Name = "Max", Tag = "pet" };
        Animal asAnimal = rex;
        Console.WriteLine(rex + " " + (rex == copy) + " " + ReferenceEquals(rex, copy) + " " + (rex == renamed) + " " + asAnimal.Equals(copy) + " " + (rex.GetHashCode() == copy.GetHashCode()));
        Console.WriteLine(renamed + " " + renamed.Greet() + " " + renamed.Legs);
        var puppy = new Puppy("Bit", "collie", 6) { Tag = "new" };
        Dog upcast = puppy;
        Console.WriteLine(puppy + " | " + puppy.Greet() + " | " + (upcast with { Breed = "lab" }) + " | " + (upcast == new Dog("Bit", "collie")) + " " + (puppy with { Weeks = 9 }).Greet());
        Animal[] zoo = { rex, puppy, puppy with { Weeks = 12 }, new Dog("Odie", "beagle"), new Bird("Tweety", true), new Bird("Pingu", false) };
        foreach (var animal in zoo) Console.WriteLine(Classify(animal) + " <- " + animal);
        var (name, legs) = asAnimal;
        var (dogName, breed) = rex;
        Console.WriteLine(name + legs + dogName + breed + " " + zoo.Distinct().Count() + " " + zoo.OfType<Dog>().Count() + " " + new HashSet<Animal>(zoo) { rex with { } }.Count);

        var price = new Money(10.26m, "EUR");
        var total = price + new Money(0.5m, "EUR");
        total.Amount += 1;
        Console.WriteLine(total + " " + total.Rounded() + " " + (price == new Money(10.26m, "EUR")) + " " + (price != total) + " " + price.GetHashCode().Equals(new Money(10.26m, "EUR").GetHashCode()));
        try { Console.WriteLine(price + new Money(1, "USD")); }
        catch (InvalidOperationException e) { Console.WriteLine("mismatch " + e.Message); }
        var here = Coordinate.Origin.Move(3, -4);
        var (x, y) = here;
        Console.WriteLine(here + " " + here.Manhattan + " " + x + y + " " + (here with { Y = 0 }) + " " + here.Equals(new Coordinate(3, -4)) + " " + default(Coordinate));

        var first = new Order(1, "a", "b");
        var second = new Order(1, new List<string> { "a", "b" });
        Console.WriteLine((first == second) + " " + first.Count + " " + (first with { Id = 2 } == second) + " " + first.ToString().StartsWith("Order { Id = 1, Items = "));
        var person = new Person { First = "Ada", Last = "Lovelace", Age = 36 };
        var (givenName, familyName) = person;
        var older = person with { Age = person.Age + 1 };
        Console.WriteLine(person + " " + givenName + familyName + " " + older.Age + " " + (person == older) + " " + (person == older with { Age = 36 }) + " " + person.Full);
    }
}
