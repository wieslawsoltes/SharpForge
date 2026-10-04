using System;
using System.Collections.Generic;
using System.Linq;

Expr x = new Var("x"), y = new Var("y");
var cases = new Expr[]
{
    new Add(new Const(0), x),
    new Mul(new Add(new Const(2), new Const(3)), x),
    new Mul(x, new Const(0)),
    new Neg(new Neg(y)),
    new Add(x, new Neg(x)),
    new Call("max", new Expr[] { new Const(1), new Const(7), new Const(3) }),
    new Call("max", new[] { x }),
    new Call("sum", new[] { new Const(1), x, new Const(2), y }),
    new Mul(new Const(2), new Mul(new Const(3), x)),
    new Add(new Add(x, new Const(1)), new Const(2)),
    new Let("t", new Add(new Const(1), new Const(3)), new Mul(new Var("t"), new Add(new Var("t"), y))),
    new Cond(new Add(new Const(1), new Const(-1)), x, new Mul(new Const(1), y)),
    new Cond(new Const(5), new Neg(new Const(4)), y),
    new Cond(x, new Mul(new Const(-1), y), new Call("abs", new Expr[] { new Neg(new Add(x, y)) })),
    new Call("abs", new Expr[] { new Const(-9) }),
    new Mul(new Add(x, new Const(4)), new Add(new Const(0), new Neg(new Const(-2)))),
};
var env = new Dictionary<string, int> { ["x"] = 3, ["y"] = -4 };
foreach (var expression in cases)
{
    var simple = Algebra.Simplify(expression);
    int before = Algebra.Eval(expression, env), after = Algebra.Eval(simple, env);
    Console.WriteLine($"{Algebra.Show(expression)}  =>  {Algebra.Show(simple)}  [{before}{(before == after ? "" : " MISMATCH " + after)}; size {Algebra.Size(expression)}->{Algebra.Size(simple)}]");
}

var thunks = new List<Func<string>>();
foreach (var expression in cases) Algebra.Collect(expression, thunks);
Console.WriteLine(thunks.Count + ": " + string.Join(" ", thunks.Select(t => t()).Distinct().OrderBy(s => s, StringComparer.Ordinal)));
Console.WriteLine(string.Join(" ", cases.Select(Algebra.Shape).GroupBy(s => s).OrderBy(g => g.Key, StringComparer.Ordinal).Select(g => g.Key + "x" + g.Count())));
try { Algebra.Eval(new Add(x, new Var("z")), env); }
catch (KeyNotFoundException e) { Console.WriteLine("unbound: " + e.Message); }

public abstract record Expr;
public sealed record Const(int Value) : Expr;
public sealed record Var(string Name) : Expr;
public sealed record Neg(Expr Operand) : Expr;
public sealed record Add(Expr Left, Expr Right) : Expr;
public sealed record Mul(Expr Left, Expr Right) : Expr;
public sealed record Cond(Expr Test, Expr Then, Expr Else) : Expr;
public sealed record Let(string Name, Expr Value, Expr Body) : Expr;
public sealed record Call(string Name, Expr[] Args) : Expr;

public static class Algebra
{
    public static Expr Simplify(Expr expression) => expression switch
    {
        Add(var left, var right) => (Simplify(left), Simplify(right)) switch
        {
            (Const(0), var other) => other,
            (var other, Const(0)) => other,
            (Const(var a), Const(var b)) => new Const(a + b),
            (var a, Neg(var b)) when a == b => new Const(0),
            (Add(var inner, Const(var a)), Const(var b)) => new Add(inner, new Const(a + b)),
            (Const constant, var other and not Const) => new Add(other, constant),
            var (a, b) => new Add(a, b),
        },
        Mul(var left, var right) => (Simplify(left), Simplify(right)) switch
        {
            (Const(0), _) or (_, Const(0)) => new Const(0),
            (Const(1), var other) => other,
            (var other, Const(1)) => other,
            (Const(var a), Const(var b)) => new Const(a * b),
            (Const(var a), Mul(Const(var b), var rest)) => new Mul(new Const(a * b), rest),
            (Const(-1), var other) => new Neg(other),
            (var other and not Const, Const constant) => new Mul(constant, other),
            var (a, b) => new Mul(a, b),
        },
        Neg(var operand) => Simplify(operand) switch
        {
            Const(var value) => new Const(-value),
            Neg(var twice) => twice,
            var other => new Neg(other),
        },
        Cond(var test, var then, var otherwise) => Simplify(test) switch
        {
            Const(0) => Simplify(otherwise),
            Const => Simplify(then),
            var kept => new Cond(kept, Simplify(then), Simplify(otherwise)),
        },
        Call(var name, var args) => SimplifyCall(name, args.Select(Simplify).ToArray()),
        Let(var name, var value, var body) => Simplify(Substitute(body, name, Simplify(value))),
        Const or Var => expression,
        _ => throw new InvalidOperationException("unknown node"),
    };

    private static Expr SimplifyCall(string name, Expr[] args) => (name, args) switch
    {
        ("max" or "min", [var only]) => only,
        ("max", [Const(var a), Const(var b), .. var rest]) => SimplifyCall("max", [new Const(Math.Max(a, b)), .. rest]),
        ("sum", []) => new Const(0),
        ("sum", [.. var init, var last]) => Simplify(new Add(SimplifyCall("sum", init), last)),
        ("abs", [Const(var value)]) => new Const(value is < 0 ? -value : value),
        ("abs", [Neg(var inner)]) => new Call("abs", [inner]),
        _ => new Call(name, args),
    };

    private static Expr Substitute(Expr body, string name, Expr value) => body switch
    {
        Var(var found) when found == name => value,
        Neg(var operand) => new Neg(Substitute(operand, name, value)),
        Add(var l, var r) => new Add(Substitute(l, name, value), Substitute(r, name, value)),
        Mul(var l, var r) => new Mul(Substitute(l, name, value), Substitute(r, name, value)),
        Cond(var t, var a, var b) => new Cond(Substitute(t, name, value), Substitute(a, name, value), Substitute(b, name, value)),
        Call call => call with { Args = call.Args.Select(arg => Substitute(arg, name, value)).ToArray() },
        Let(var inner, var bound, var scope) => new Let(inner, Substitute(bound, name, value), inner == name ? scope : Substitute(scope, name, value)),
        _ => body,
    };

    public static int Eval(Expr expression, Dictionary<string, int> env) => expression switch
    {
        Const { Value: var value } => value,
        Var(var name) when env.TryGetValue(name, out int bound) => bound,
        Var { Name: var missing } => throw new KeyNotFoundException(missing),
        Neg(var operand) => -Eval(operand, env),
        Add(var l, var r) => Eval(l, env) + Eval(r, env),
        Mul(var l, var r) => Eval(l, env) * Eval(r, env),
        Cond(var test, var then, var otherwise) => Eval(Eval(test, env) is not 0 ? then : otherwise, env),
        Let(var name, var value, var body) => Eval(body, new Dictionary<string, int>(env) { [name] = Eval(value, env) }),
        Call("max", { Length: > 0 } args) => args.Max(a => Eval(a, env)),
        Call("min", { Length: > 0 } args) => args.Min(a => Eval(a, env)),
        Call("sum", var args) => args.Sum(a => Eval(a, env)),
        Call("abs", [var only]) => Math.Abs(Eval(only, env)),
        _ => throw new InvalidOperationException("cannot evaluate"),
    };

    public static string Show(Expr expression) => expression switch
    {
        Const { Value: < 0 and var negative } => "(" + negative + ")",
        Const(var value) => value.ToString(),
        Var(var name) => name,
        Neg(Const or Var or Call) negation => "-" + Show(negation.Operand),
        Neg(var operand) => "-(" + Show(operand) + ")",
        Add(var l, Neg(var r)) => Show(l) + " - " + Wrap(r),
        Add(var l, var r) => Show(l) + " + " + Show(r),
        Mul(var l, var r) => Wrap(l) + "*" + Wrap(r),
        Cond(var test, var then, var otherwise) => $"{Wrap(test)} ? {Wrap(then)} : {Wrap(otherwise)}",
        Let(var name, var value, var body) => $"let {name} = {Show(value)} in {Show(body)}",
        Call(var name, var args) => name + "(" + string.Join(", ", args.Select(Show)) + ")",
        _ => "?",
    };

    private static string Wrap(Expr expression) => expression is Add or Cond or Let ? "(" + Show(expression) + ")" : Show(expression);

    public static int Size(Expr expression) => expression switch
    {
        Const or Var => 1,
        Neg { Operand: var operand } => 1 + Size(operand),
        Add { Left: var l, Right: var r } => 1 + Size(l) + Size(r),
        Mul product and ({ Left: Const } or { Right: Const }) => 2 + Size(product.Left is Const ? product.Right : product.Left),
        Mul { Left: var l, Right: var r } => 1 + Size(l) + Size(r),
        Cond c => 1 + Size(c.Test) + Size(c.Then) + Size(c.Else),
        Let { Value: var value, Body: var body } => 1 + Size(value) + Size(body),
        Call { Args: var args } => 1 + args.Sum(Size),
        _ => 0,
    };

    public static string Shape(Expr expression) => expression switch
    {
        Add { Left: Const, Right: not Const } or Add { Left: not Const, Right: Const } or Mul(Const, not Const) or Mul(not Const, Const) => "half-constant",
        Add(Const, Const) or Mul(Const, Const) or Neg(Const) => "constant",
        Call { Name: "max" or "min", Args.Length: var arity } => "extremum/" + arity,
        Call or Let => "binding-or-call",
        Cond(Const, _, _) => "static-branch",
        { } node => node.GetType().Name.ToLowerInvariant(),
        null => "null",
    };

    public static void Collect(Expr expression, List<Func<string>> thunks)
    {
        if (expression is Var(var name)) thunks.Add(() => name);
        else if (expression is Call { Args: { Length: > 0 } args } call)
        {
            thunks.Add(() => call.Name + "/" + args.Length);
            foreach (var arg in args) Collect(arg, thunks);
        }
        else if (expression is Neg(var only)) Collect(only, thunks);
        else if (expression is Add(var l, var r) || expression is Mul(var l2, var r2) && (l = l2) != null && (r = r2) != null) { Collect(l, thunks); Collect(r, thunks); }
        else if (expression is Cond(var test, var then, var otherwise)) { foreach (var part in new[] { test, then, otherwise }) Collect(part, thunks); }
        else if (expression is Let(var bound, var value, var body) and not Let(_, Const, Const)) { thunks.Add(() => "let:" + bound); Collect(value, thunks); Collect(body, thunks); }
    }
}
