using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public readonly struct Option<T>
{
    private readonly T value;
    private Option(T value) { this.value = value; HasValue = true; }
    public bool HasValue { get; }
    public static Option<T> None => default;
    public static Option<T> Some(T value) => new Option<T>(value);
    public static implicit operator Option<T>(T value) => value is null ? None : Some(value);
    public Option<TResult> Select<TResult>(Func<T, TResult> map) => HasValue ? Option<TResult>.Some(map(value)) : Option<TResult>.None;
    public Option<TResult> SelectMany<TMiddle, TResult>(Func<T, Option<TMiddle>> bind, Func<T, TMiddle, TResult> project)
    {
        if (!HasValue) return Option<TResult>.None;
        var middle = bind(value);
        return middle.HasValue ? Option<TResult>.Some(project(value, middle.value)) : Option<TResult>.None;
    }
    public Option<T> Where(Func<T, bool> predicate) => HasValue && predicate(value) ? this : None;
    public T OrElse(T fallback) => HasValue ? value : fallback;
    public TResult Match<TResult>(Func<T, TResult> some, Func<TResult> none) => HasValue ? some(value) : none();
    public override string ToString() => HasValue ? "Some(" + value + ")" : "None";
}

public abstract class Result<T, TError>
{
    public sealed class Ok : Result<T, TError>
    {
        public Ok(T value) { Value = value; }
        public T Value { get; }
    }
    public sealed class Fail : Result<T, TError>
    {
        public Fail(TError error) { Error = error; }
        public TError Error { get; }
    }
    public static implicit operator Result<T, TError>(T value) => new Ok(value);
    public static implicit operator Result<T, TError>(TError error) => new Fail(error);
    public Result<TNext, TError> Then<TNext>(Func<T, Result<TNext, TError>> next) => this switch
    {
        Ok ok => next(ok.Value),
        Fail fail => new Result<TNext, TError>.Fail(fail.Error),
        _ => throw new InvalidOperationException(),
    };
    public Result<TNext, TError> Map<TNext>(Func<T, TNext> map) => Then(value => (Result<TNext, TError>)new Result<TNext, TError>.Ok(map(value)));
    public override string ToString() => this is Ok ok ? "Ok(" + ok.Value + ")" : "Fail(" + ((Fail)this).Error + ")";
}

public enum ParseError { Empty, NotANumber, Negative, TooLarge }

public static class Program
{
    private static Option<int> ParseInt(string text) => int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out int value) ? Option<int>.Some(value) : Option<int>.None;
    private static Option<double> SafeDivide(double a, double b) => b == 0 ? Option<double>.None : Option<double>.Some(a / b);
    private static Option<TValue> Lookup<TKey, TValue>(IReadOnlyDictionary<TKey, TValue> map, TKey key) => map.TryGetValue(key, out var value) ? Option<TValue>.Some(value) : Option<TValue>.None;

    private static Result<int, ParseError> Parse(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return ParseError.Empty;
        if (!int.TryParse(text, out int value)) return ParseError.NotANumber;
        return value;
    }

    private static Result<int, ParseError> Validate(int value)
    {
        if (value < 0) return ParseError.Negative;
        if (value > 1000) return ParseError.TooLarge;
        return value;
    }

    private static IEnumerable<TResult> Choose<T, TResult>(IEnumerable<T> source, Func<T, Option<TResult>> chooser)
    {
        foreach (var item in source)
        {
            var result = chooser(item);
            if (result.HasValue) yield return result.OrElse(default);
        }
    }

    public static void Main()
    {
        var ages = new Dictionary<string, string> { ["ada"] = "36", ["bob"] = "x", ["cy"] = "0", ["dee"] = "50" };
        foreach (var name in new[] { "ada", "bob", "cy", "dee", "eve" })
        {
            var ratio = from text in Lookup(ages, name)
                        from age in ParseInt(text)
                        from share in SafeDivide(100, age)
                        where share < 2.5
                        select $"{name}:{age}:{share.ToString("0.00", CultureInfo.InvariantCulture)}";
            Console.Write(ratio + " ");
        }
        Console.WriteLine();
        Option<string> fromNull = (string)null, fromValue = "text";
        Option<int> number = 5;
        Console.WriteLine(fromNull + " " + fromValue + " " + number.Select(n => n * 2).Where(n => n > 5) + " " + number.Where(n => n > 5).OrElse(-1) + " " + fromValue.Match(s => s.Length, () => 0) + " " + fromNull.Match(s => s.Length, () => -1) + " " + default(Option<DateTime>).HasValue);
        Console.WriteLine(string.Join(",", Choose(new[] { "1", "x", "3", "", "5" }, ParseInt)) + " " + Choose(ages.Values, ParseInt).Sum() + " " + new[] { 4.0, 0, 2 }.Select(d => SafeDivide(8, d)).Count(o => o.HasValue));

        foreach (var input in new[] { "42", "", "abc", "-5", "5000", "  7 " })
        {
            var result = Parse(input).Then(Validate).Map(v => v * 2).Map(v => "#" + v);
            string summary = result switch
            {
                Result<string, ParseError>.Ok { Value: var v } => "ok " + v,
                Result<string, ParseError>.Fail { Error: ParseError.Empty or ParseError.NotANumber } f => "syntax " + f.Error,
                Result<string, ParseError>.Fail f => "range " + f.Error,
                _ => "?",
            };
            Console.Write($"[{summary} / {result}] ");
        }
        Console.WriteLine();
        Result<List<int>, string> listResult = new List<int> { 1, 2, 3 };
        Result<int, string> failed = "broken";
        Console.WriteLine(listResult.Map(l => l.Sum()) + " " + failed.Map(v => v + 1).Then<double>(v => v / 2.0) + " " + listResult.Then<int>(l => l.Count > 5 ? l.Count : "too short"));
    }
}
