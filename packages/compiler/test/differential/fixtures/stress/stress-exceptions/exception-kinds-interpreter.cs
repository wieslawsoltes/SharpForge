using System;
using System.Collections.Generic;
using System.Globalization;

var programs = new (string Name, string Source)[]
{
    ("sum", "2 3 + 4 *"), ("variable", "$ten 3 % $ten *"), ("sqrt", "2 sqrt"), ("text", "\"forge\" upper len"),
    ("div0", "1 0 /"), ("overflow", "2147483647 1 +"), ("wrap", "2147483647 1 wrap+"), ("minint", "-2147483648 -1 /"),
    ("negmin", "-2147483648 neg"), ("format", "12x 1 +"), ("too-big", "2147483648"), ("empty", "+"),
    ("index", "5 idx"), ("key", "$missing"), ("cast", "\"text\" neg"), ("null", "null len"),
    ("nullarg", "null upper"), ("range", "-5 sqrt"), ("store", "7 store"), ("unwrap", "null unwrap"),
    ("mutate", "3 mutate"), ("config", "cfg"), ("config2", "1 cfg +"), ("unknown", "1 frobnicate"), ("leftover", "1 2"),
};

static string Format(object value) => value switch
{
    null => "null",
    double d => d.ToString("0.####", CultureInfo.InvariantCulture),
    string s => "\"" + s + "\"",
    _ => Convert.ToString(value, CultureInfo.InvariantCulture),
};

static string Classify(Func<object> run)
{
    try { return "ok " + Format(run()); }
    catch (DivideByZeroException) { return "DivideByZeroException"; }
    catch (ArithmeticException e) { return "arithmetic/" + e.GetType().Name; }
    catch (ArgumentNullException e) { return "ArgumentNullException param=" + e.ParamName; }
    catch (ArgumentOutOfRangeException e) { return "ArgumentOutOfRangeException param=" + e.ParamName + " actual=" + Format(e.ActualValue); }
    catch (TypeInitializationException e) { return "TypeInitializationException type=" + e.TypeName + " inner=" + e.InnerException.GetType().Name + ": " + e.InnerException.Message; }
    catch (ScriptException e) { return "ScriptException at " + e.Position + ": " + e.Message; }
    catch (SystemException e) when (e is IndexOutOfRangeException or KeyNotFoundException) { return "lookup/" + e.GetType().Name; }
    catch (Exception e) { return e.GetType().Name; }
}

var counts = new SortedDictionary<string, int>(StringComparer.Ordinal);
foreach (var (name, source) in programs)
{
    string verdict = Classify(() => Interpreter.Run(source));
    Console.WriteLine(name.PadRight(9) + "=> " + verdict);
    string key = verdict.StartsWith("ok ", StringComparison.Ordinal) ? "ok" : "failed";
    counts[key] = counts.TryGetValue(key, out int seen) ? seen + 1 : 1;
}
Console.WriteLine(string.Join(", ", counts) + " static-ctor-runs=" + Probe.StaticCtorRuns);

Outcome chained = Outcome.Of(() => Interpreter.Run("6 7 *")).Then(v => (int)v + 1).Then(v => Interpreter.Run(v + " 0 /")).Then(v => "never");
Console.WriteLine("chained ok=" + chained.Ok + " error=" + chained.Error.GetType().Name + " fallback=" + Format(chained.OrElse(-1)));
Outcome good = Outcome.Of(() => Interpreter.Run("\"a\" upper")).Then(v => v + "!");
Console.WriteLine("good ok=" + good.Ok + " value=" + Format(good.ValueOrThrow) + " fallback=" + Format(good.OrElse("unused")));
try { Console.WriteLine(Format(chained.ValueOrThrow)); }
catch (DivideByZeroException e) { Console.WriteLine("ValueOrThrow rethrew same instance: " + ReferenceEquals(e, chained.Error)); }

string missing = null;
try { Console.WriteLine((missing ?? throw new ScriptException("no default", -1)).Length); }
catch (ScriptException e) { Console.WriteLine("throw in ??: " + e.Message + " @" + e.Position); }

sealed class ScriptException : Exception
{
    public int Position { get; }
    public ScriptException(string message, int position) : base(message) { Position = position; }
}

static class Probe { public static int StaticCtorRuns; }

static class Config
{
    public static readonly string Endpoint;
    static Config()
    {
        Probe.StaticCtorRuns++;
        Endpoint = Probe.StaticCtorRuns > 0 ? throw new InvalidOperationException("config missing: endpoint") : "http://localhost";
    }
}

readonly struct Outcome
{
    public object Value { get; }
    public Exception Error { get; }
    private Outcome(object value, Exception error) { Value = value; Error = error; }
    public bool Ok => Error == null;
    public object ValueOrThrow => Ok ? Value : throw Error;
    public object OrElse(object fallback) => Ok ? Value : fallback;
    public Outcome Then(Func<object, object> next) => Ok ? Of(Bind(next, Value)) : this;
    private static Func<object> Bind(Func<object, object> next, object value) => () => next(value);

    public static Outcome Of(Func<object> compute)
    {
        try { return new Outcome(compute(), null); }
        catch (Exception e) { return new Outcome(null, e); }
    }
}

static class Interpreter
{
    private static readonly Dictionary<string, object> variables = new Dictionary<string, object> { ["ten"] = 10, ["name"] = "forge" };
    private static readonly int[] table = { 10, 20, 30 };

    private static int PopInt(Stack<object> stack) => (int)stack.Pop();

    private static void Binary(Stack<object> stack, Func<int, int, int> op)
    {
        int right = PopInt(stack), left = PopInt(stack);
        stack.Push(op(left, right));
    }

    public static object Run(string source)
    {
        var stack = new Stack<object>();
        string[] tokens = source.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        for (int position = 0; position < tokens.Length; position++)
        {
            string token = tokens[position];
            switch (token)
            {
                case "+": Binary(stack, (a, b) => checked(a + b)); break;
                case "wrap+": Binary(stack, (a, b) => unchecked(a + b)); break;
                case "*": Binary(stack, (a, b) => checked(a * b)); break;
                case "/": Binary(stack, (a, b) => a / b); break;
                case "%": Binary(stack, (a, b) => a % b); break;
                case "neg": stack.Push(checked(-PopInt(stack))); break;
                case "idx": stack.Push(table[PopInt(stack)]); break;
                case "len": stack.Push(((string)stack.Pop()).Length); break;
                case "null": stack.Push(null); break;
                case "cfg": stack.Push(Config.Endpoint.Length); break;
                case "sqrt":
                {
                    int number = PopInt(stack);
                    ArgumentOutOfRangeException.ThrowIfNegative(number);
                    stack.Push(Math.Sqrt(number));
                    break;
                }
                case "upper":
                {
                    string text = stack.Pop() as string;
                    ArgumentNullException.ThrowIfNull(text);
                    stack.Push(text.ToUpperInvariant());
                    break;
                }
                case "store":
                {
                    object[] cells = new string[2];
                    cells[0] = stack.Pop();
                    stack.Push(cells.Length);
                    break;
                }
                case "unwrap":
                {
                    int? maybe = stack.Pop() as int?;
                    stack.Push(maybe.Value);
                    break;
                }
                case "mutate":
                {
                    var items = new List<int> { 1, 2, PopInt(stack) };
                    foreach (int item in items) if (item == 2) items.Add(item);
                    stack.Push(items.Count);
                    break;
                }
                default:
                    stack.Push(token[0] == '$' ? variables[token.Substring(1)]
                        : token[0] == '"' ? (object)token.Trim('"')
                        : char.IsDigit(token[0]) || token[0] == '-' ? int.Parse(token, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture)
                        : throw new ScriptException("unknown word '" + token + "'", position));
                    break;
            }
        }
        return stack.Count == 1 ? stack.Pop() : throw new ScriptException("stack has " + stack.Count + " values", tokens.Length);
    }
}
