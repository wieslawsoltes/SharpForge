using System;
using System.Collections.Generic;
using System.Linq;

public class Animal { public virtual string Name => "animal"; }
public class Dog : Animal { public override string Name => "dog"; }
public class Puppy : Dog { public override string Name => "puppy"; }

public interface IProducer<out T> { T Produce(); }
public interface IConsumer<in T> { string Consume(T item); }
public interface ITransformer<in TIn, out TOut> { TOut Transform(TIn input); }

public sealed class Kennel<T> : IProducer<T>, IConsumer<T> where T : Animal, new()
{
    public T Produce() => new T();
    public string Consume(T item) => typeof(T).Name + " kennel took " + item.Name;
}

public sealed class Namer : ITransformer<Animal, string>, IConsumer<object>
{
    public string Transform(Animal input) => "<" + input.Name + ">";
    public string Consume(object item) => "object:" + item;
}

public delegate TResult Converter2<in T, out TResult>(T input);

public static class Counter<T>
{
    private static int count;
    public static readonly string Label = "Counter<" + typeof(T).Name + ">";
    public static int Next() => ++count;
    public static int Count => count;
}

public class Registry<TBase>
{
    private static readonly Dictionary<Type, Func<TBase>> factories = new Dictionary<Type, Func<TBase>>();
    public static void Register<T>() where T : TBase, new() => factories[typeof(T)] = () => new T();
    public static IEnumerable<TBase> CreateAll() => factories.OrderBy(pair => pair.Key.Name).Select(pair => pair.Value());
    public static int Count => factories.Count;
}

public abstract class Singleton<TSelf> where TSelf : Singleton<TSelf>, new()
{
    private static TSelf instance;
    public static TSelf Instance => instance ??= new TSelf();
    public int Uses { get; private set; }
    public TSelf Use() { Uses++; return (TSelf)this; }
}

public sealed class Config : Singleton<Config> { public string Mode = "debug"; }
public sealed class Session : Singleton<Session> { public int User = 7; }

public static class Program
{
    private static string Feed(IProducer<Animal> producer) => producer.Produce().Name;
    private static string Fill(IConsumer<Puppy> consumer) => consumer.Consume(new Puppy());
    private static string Names(IEnumerable<Animal> animals) => string.Join(",", animals.Select(a => a.Name));
    private static string Invoke(Func<Dog, object> function) => function(new Puppy()).ToString();

    public static void Main()
    {
        var dogs = new Kennel<Dog>();
        var puppies = new Kennel<Puppy>();
        IProducer<Animal> producer = puppies;
        IConsumer<Puppy> consumer = dogs;
        Console.WriteLine(Feed(dogs) + " " + Feed(producer) + " | " + Fill(consumer) + " | " + Fill(new Kennel<Animal>()) + " | " + Fill(new Namer()).Length);

        ITransformer<Animal, string> namer = new Namer();
        ITransformer<Puppy, object> narrowed = namer;
        Console.WriteLine(narrowed.Transform(new Puppy()) + " " + (narrowed is ITransformer<Dog, IComparable>) + " " + (narrowed is ITransformer<object, string>));

        List<Puppy> litter = new List<Puppy> { new Puppy(), new Puppy() };
        IEnumerable<Animal> animals = litter;
        IReadOnlyList<Dog> readOnly = litter;
        Dog[] dogArray = { new Dog(), new Puppy() };
        Animal[] covariantArray = dogArray;
        Console.WriteLine(Names(litter) + " " + Names(dogArray) + " " + readOnly.Count + " " + covariantArray[1].Name + " " + animals.Concat(dogArray).Count());
        try { covariantArray[0] = new Animal(); }
        catch (ArrayTypeMismatchException) { Console.WriteLine("array type mismatch"); }

        Func<Animal, string> describe = a => "it is a " + a.Name;
        Func<Puppy, object> viaVariance = describe;
        Action<Animal> act = a => Console.Write(a.Name + "! ");
        Action<Dog> actOnDog = act;
        Converter2<Animal, Dog> breed = a => a is Dog d ? d : new Dog();
        Converter2<Puppy, Animal> widened = breed;
        Comparison<Animal> byName = (x, y) => string.CompareOrdinal(x.Name, y.Name);
        Comparison<Dog> dogComparison = byName;
        actOnDog(new Puppy());
        Array.Sort(dogArray, dogComparison);
        Console.WriteLine(viaVariance(new Puppy()) + " " + Invoke(describe) + " " + widened(new Puppy()).Name + " " + dogArray[0].Name);
        IComparer<Animal> comparer = Comparer<Animal>.Create(byName);
        var sorted = new SortedSet<Puppy>(comparer) { new Puppy() };
        IEqualityComparer<object> reference = EqualityComparer<object>.Default;
        var set = new HashSet<string>(reference) { "a", "a" };
        Console.WriteLine(sorted.Count + " " + set.Count);

        Counter<int>.Next(); Counter<int>.Next(); Counter<string>.Next(); Counter<List<int>>.Next();
        Console.WriteLine(Counter<int>.Count + " " + Counter<string>.Count + " " + Counter<long>.Count + " " + Counter<List<int>>.Label + " " + Counter<Dog>.Label);
        Registry<Animal>.Register<Puppy>();
        Registry<Animal>.Register<Dog>();
        Registry<Animal>.Register<Dog>();
        Registry<object>.Register<Animal>();
        Console.WriteLine(Names(Registry<Animal>.CreateAll()) + " " + Registry<Animal>.Count + " " + Registry<object>.Count + " " + Registry<Dog>.Count);
        Config.Instance.Use().Use().Mode = "release";
        Session.Instance.Use();
        Console.WriteLine(Config.Instance.Mode + Config.Instance.Uses + " " + Session.Instance.User + Session.Instance.Uses + " " + ReferenceEquals(Config.Instance, Singleton<Config>.Instance));
    }
}
