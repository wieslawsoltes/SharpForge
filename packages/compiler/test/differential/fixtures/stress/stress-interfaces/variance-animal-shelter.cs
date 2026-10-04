using System;
using System.Collections.Generic;
using System.Linq;

var log = new List<string>();

// Covariant producers and contravariant consumers of our own interfaces.
IProducer<Lion> lionLitter = new Litter<Lion>("L");
IProducer<Cat> catLitter = lionLitter;
IProducer<Animal> anyLitter = catLitter;
IProducer<object> objects = anyLitter;
Console.WriteLine("producers: " + lionLitter.Produce() + " " + catLitter.Produce() + " " + anyLitter.Produce().Speak() + " " + objects.Produce() + " same=" + ReferenceEquals(lionLitter, objects)
    + " many=" + string.Join(",", anyLitter.ProduceMany(2)) + " " + (objects is IProducer<Dog>) + (objects is IProducer<Cat>) + (objects is Litter<Lion>));

var vet = new Vet();
IConsumer<Animal> animalVet = vet;
IConsumer<Cat> catVet = animalVet;
IConsumer<Lion> lionVet = catVet;
lionVet.Consume(new Lion { Name = "Leo", Weight = 190 });
catVet.Consume(new Cat { Name = "Tom", Weight = 4 });
animalVet.Consume(new Dog { Name = "Rex", Weight = 30 });
Console.WriteLine("consumers: " + vet.Report + " count=" + lionVet.Consumed + " " + (catVet is IConsumer<Dog>) + (catVet is IConsumer<string>) + ((object)vet is IConsumer<object>));
Console.WriteLine("inference: " + Feeder.Feed(new List<Lion> { new Lion { Name = "Nala" } }, animalVet) + " " + Feeder.Feed(new[] { new Cat { Name = "Kit" } }, catVet) + " " + Feeder.Feed<Lion>(Array.Empty<Lion>(), animalVet) + " total=" + vet.Consumed);

// BCL variance: IEnumerable<out T>, IReadOnlyList<out T>, IComparer<in T>, IEqualityComparer<in T>.
var lions = new List<Lion> { new Lion { Name = "Zed", Weight = 150 }, new Lion { Name = "Amy", Weight = 120 }, new Lion { Name = "zed", Weight = 170 } };
IEnumerable<Animal> asAnimals = lions;
IReadOnlyList<Cat> asCats = lions;
lions.Sort(new ByWeight());
var distinct = new HashSet<Lion>(lions, new ByNameIgnoreCase());
Console.WriteLine("bcl: " + string.Join(",", asAnimals.Select(a => a.Name)) + " heaviest=" + asCats[asCats.Count - 1].Name + " distinct=" + distinct.Count + " total=" + Zoo.TotalWeight(lions) + "/" + Zoo.TotalWeight(new Dog[] { new Dog { Weight = 7 } })
    + " max=" + lions.Max(new ByWeight()).Name + " ordered=" + string.Join(",", lions.OrderBy(l => l, Comparer<Animal>.Create((a, b) => string.CompareOrdinal(a.Name, b.Name))).Select(l => l.Name)));
Console.WriteLine("overloads: " + Zoo.Pick(lions) + "/" + Zoo.Pick(new List<Dog>()) + "/" + Zoo.Pick(new List<string>()) + "/" + Zoo.Pick(asAnimals) + "/" + Zoo.Pick(asCats) + "/" + Zoo.Pick(new Lion[0]) + "/" + Zoo.Pick(new object[0]));

// Runtime type tests see variance for reference types only.
object lionList = lions, intList = new List<int> { 1 }, lionArray = lions.ToArray();
Console.WriteLine("is (list): " + (lionList is IEnumerable<Animal>) + " " + (lionList is IEnumerable<object>) + " " + (lionList is IList<Animal>) + " " + (lionList is IReadOnlyCollection<Cat>) + " " + (lionList is IEnumerable<Dog>));
Console.WriteLine("is (value types, arrays): " + (intList is IEnumerable<object>) + " " + (intList is IEnumerable<int>) + " " + (intList is IEnumerable<IComparable>) + " | " + (lionArray is Animal[]) + " " + (lionArray is IList<Cat>) + " " + (lionArray is object[]) + " " + (lionArray is Dog[]));

// Delegates: Action<in T>, Func<in T, out TResult> and custom variant delegates, with lambdas and method groups.
Action<Animal> logAnimal = a => log.Add("animal:" + a.Name);
Action<Cat> logCat = logAnimal;
Action<Lion> logLion = Zoo.Register;
Func<Lion> makeLion = () => new Lion { Name = "Fresh" };
Func<Animal> makeAnimal = makeLion;
Func<Animal, Lion> promote = a => new Lion { Name = a.Name + "!", Weight = a.Weight * 2 };
Func<Cat, Animal> promoteCat = promote;
Mapper<Lion, object> describe = Zoo.Describe;
Mapper<Animal, string> describeAnimal = Zoo.Describe;
Mapper<Cat, IComparable> describeCat = describeAnimal;
Source<Cat> catSource = Zoo.NewLion;
Source<object> anySource = catSource;
Order<Animal> byWeight = (a, b) => a.Weight.CompareTo(b.Weight);
Order<Lion> lionOrder = byWeight;
logCat(new Lion { Name = "viaCat" });
logLion(new Lion { Name = "viaGroup" });
lions.Sort(new Comparison<Animal>((a, b) => byWeight(b, a)));
Console.WriteLine("delegates: " + makeAnimal().Name + " " + promoteCat(new Cat { Name = "Tig", Weight = 3 }) + " " + describe(lions[0]) + " " + describeCat(new Cat { Name = "Mo" }) + " " + anySource() + " " + lionOrder(lions[0], lions[1])
    + " sorted=" + string.Join(",", lions.Select(l => l.Weight)) + " same=" + ReferenceEquals(logAnimal, logCat) + " " + (makeAnimal is Func<Lion>) + ((object)promoteCat is Func<Lion, object>) + " log=" + string.Join(";", log) + ";" + string.Join(";", Zoo.Registered));

// Combining delegates of different (but convertible) runtime types fails; re-wrapping fixes it.
Action<Cat> plainCat = c => log.Add("cat:" + c.Name);
log.Clear();
try { Action<Cat> mixed = plainCat; mixed += logCat; mixed(new Cat { Name = "mix" }); }
catch (ArgumentException e) { log.Add(e.GetType().Name); }
Action<Cat> wrapped = plainCat + new Action<Cat>(logAnimal);
wrapped(new Cat { Name = "ok" });
Console.WriteLine("combine: " + string.Join(";", log) + " targets=" + wrapped.GetInvocationList().Length);

// Array covariance is checked at run time on every store.
Animal[] cage = new Cat[3];
cage[0] = new Lion { Name = "inCatArray" };
string stores = "";
try { cage[1] = new Dog { Name = "intruder" }; stores += "stored;"; } catch (ArrayTypeMismatchException) { stores += "dog rejected;"; }
try { Zoo.Replace(ref cage[2], new Cat { Name = "byRef" }); stores += "ref ok;"; } catch (ArrayTypeMismatchException) { stores += "ref rejected;"; }
object[] boxes = new string[] { "a", "b" };
try { boxes[0] = 42; } catch (ArrayTypeMismatchException) { stores += "int rejected;"; }
boxes[1] = "c";
IList<Animal> cageList = cage;
try { cageList[2] = new Dog(); } catch (ArrayTypeMismatchException) { stores += "ilist rejected;"; }
Animal[] exact = new Animal[1];
Zoo.Replace(ref exact[0], new Dog { Name = "fine" });
Console.WriteLine("arrays: " + stores + " cage=" + string.Join(",", cage.Select(a => a?.Name ?? "null")) + " type=" + cage.GetType().Name + " boxes=" + string.Join("", boxes) + " exact=" + exact[0].Name);

// Transformers with both in and out parameters, composed through their variant views; covariant return types.
ITransformer<Animal, Lion> toLion = new Promoter();
ITransformer<Cat, Animal> viaVariance = toLion;
ITransformer<object, string> name = new Namer();
var chain = Zoo.Compose<Cat, Animal, IComparable>(viaVariance, name);
Cat original = new Lion { Name = "Orig", Weight = 99 };
Cat cloneCat = original.Clone();
Animal cloneAnimal = ((Animal)original).Clone();
Console.WriteLine("transform: " + chain.Apply(new Cat { Name = "Kit", Weight = 2 }) + " " + chain.GetType().Name.Split('`')[0] + " clone=" + cloneCat.GetType().Name + "/" + cloneAnimal + "/" + new Dog { Name = "D" }.Clone().GetType().Name + " " + ReferenceEquals(original, cloneCat));

// The same handlers applied through each static view to a mixed roster.
var roster = new Animal[] { new Lion { Name = "Leo", Weight = 190 }, new Cat { Name = "Tom", Weight = 4 }, new Dog { Name = "Rex", Weight = 30 }, new Animal { Name = "Amoeba" } };
foreach (Animal animal in roster)
{
    string asCat = animal is Cat cat ? describeCat(cat) + "/" + promoteCat(cat).Weight + "/" + viaVariance.Apply(cat).Name + "/" + chain.Apply(cat) : "not a cat";
    Console.WriteLine("roster: " + describeAnimal(animal) + " -> " + asCat + " clone=" + animal.Clone() + " heavier than Tom: " + (byWeight(animal, roster[1]) > 0) + " name=" + name.Apply(animal));
}

public class Animal
{
    public string Name { get; set; } = "?";
    public int Weight { get; set; }
    public virtual string Speak() => "...";
    public virtual Animal Clone() => (Animal)MemberwiseClone();
    public override string ToString() => GetType().Name + ":" + Name;
}
public class Cat : Animal { public override string Speak() => "meow"; public override Cat Clone() => (Cat)MemberwiseClone(); }
public class Lion : Cat { public override string Speak() => "roar"; public override Lion Clone() => new Lion { Name = Name + "2", Weight = Weight }; }
public class Dog : Animal { public override string Speak() => "woof"; }

public interface IProducer<out T> { T Produce(); IEnumerable<T> ProduceMany(int count); }
public interface IConsumer<in T> { void Consume(T item); int Consumed { get; } }
public interface ITransformer<in TIn, out TOut> { TOut Apply(TIn input); }
public delegate TOut Mapper<in TIn, out TOut>(TIn input);
public delegate T Source<out T>();
public delegate int Order<in T>(T left, T right);

public sealed class Litter<T> : IProducer<T> where T : Animal, new()
{
    private readonly string prefix;
    private int born;
    public Litter(string prefix) { this.prefix = prefix; }
    public T Produce() => new T { Name = prefix + ++born };
    public IEnumerable<T> ProduceMany(int count) { for (int i = 0; i < count; i++) yield return Produce(); }
}

public sealed class Vet : IConsumer<Animal>
{
    private readonly List<string> seen = new List<string>();
    public int Consumed => seen.Count;
    public string Report => string.Join(",", seen);
    public void Consume(Animal item) => seen.Add(item.Name + "/" + item.Speak());
}

public sealed class ByWeight : IComparer<Animal> { public int Compare(Animal x, Animal y) => x.Weight.CompareTo(y.Weight); }
public sealed class ByNameIgnoreCase : IEqualityComparer<Animal>
{
    public bool Equals(Animal x, Animal y) => string.Equals(x.Name, y.Name, StringComparison.OrdinalIgnoreCase);
    public int GetHashCode(Animal obj) => obj.Name.ToUpperInvariant().GetHashCode();
}
public sealed class Promoter : ITransformer<Animal, Lion> { public Lion Apply(Animal input) => new Lion { Name = "King " + input.Name, Weight = input.Weight + 100 }; }
public sealed class Namer : ITransformer<object, string> { public string Apply(object input) => "<" + input + ">"; }

public static class Feeder
{
    public static string Feed<T>(IEnumerable<T> items, IConsumer<T> consumer)
    {
        int count = 0;
        foreach (T item in items) { consumer.Consume(item); count++; }
        return typeof(T).Name + "x" + count;
    }
}

public static class Zoo
{
    public static readonly List<string> Registered = new List<string>();
    public static void Register(Animal animal) => Registered.Add("registered:" + animal.Name);
    public static string Describe(Animal animal) => animal.Name + "(" + animal.Speak() + ")";
    public static Lion NewLion() => new Lion { Name = "Source" };
    public static int TotalWeight(IEnumerable<Animal> animals) => animals.Sum(a => a.Weight);
    public static string Pick(IEnumerable<object> items) => "objects";
    public static string Pick(IEnumerable<Animal> items) => "animals";
    public static string Pick(IEnumerable<Cat> items) => "cats";
    public static void Replace(ref Animal slot, Animal replacement) => slot = replacement;
    public static ITransformer<TA, TC> Compose<TA, TB, TC>(ITransformer<TA, TB> first, ITransformer<TB, TC> second) => new Composed<TA, TB, TC>(first, second);

    private sealed class Composed<TA, TB, TC> : ITransformer<TA, TC>
    {
        private readonly ITransformer<TA, TB> first;
        private readonly ITransformer<TB, TC> second;
        public Composed(ITransformer<TA, TB> first, ITransformer<TB, TC> second) { this.first = first; this.second = second; }
        public TC Apply(TA input) => second.Apply(first.Apply(input));
    }
}
