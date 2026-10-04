using System;
using System.Collections.Generic;
using System.Linq;

var trace = new List<string>();
Tri Probe(string name, Tri value) { trace.Add(name); return value; }
string Drain() { string text = string.Join("", trace); trace.Clear(); return text; }
Tri[] all = { Tri.False, Tri.Unknown, Tri.True };

// Truth tables for the plain operators, then for the short-circuit forms with the operands that were evaluated.
Console.WriteLine("& | ^ == != =>".PadRight(15) + string.Join(" ", all.Select(b => b.ToString().PadRight(11))));
foreach (Tri a in all)
    Console.WriteLine((a + ":").PadRight(15) +string.Join(" ", all.Select(b => ("" + (a & b).Symbol + (a | b).Symbol + (a ^ b).Symbol + (a == b).Symbol + (a != b).Symbol + a.Implies(b).Symbol).PadRight(11))) + " not=" + !a + " definite=" + ~a);
foreach (Tri a in all)
{
    var cells = new List<string>();
    foreach (Tri b in all)
    {
        Tri and = Probe("L", a) && Probe("R", b);
        string andTrace = Drain();
        Tri or = Probe("L", a) || Probe("R", b);
        cells.Add(and.Symbol + "(" + andTrace + ") " + or.Symbol + "(" + Drain() + ")");
    }
    Console.WriteLine("&& ||  " + a.Symbol + ": " + string.Join(" | ", cells));
}

// Conditions call operator true; negation and comparison results are themselves three-valued.
foreach (Tri a in all)
{
    Tri.TrueCalls = Tri.FalseCalls = 0;
    string viaIf, viaNot, viaLoop = "";
    if (a) viaIf = "yes"; else viaIf = "no";
    if (!a) viaNot = "yes"; else viaNot = "no";
    for (Tri guard = a; guard; guard = !guard | Tri.Unknown) viaLoop += "x";
    string ternary = a ? "then" : "else", nested = a == Tri.True ? "is-true" : a == Tri.Unknown ? "is-unknown?" : "other";
    int afterConditions = Tri.TrueCalls;
    bool chained = (a && Tri.True || Tri.Unknown) ? true : false;
    Console.WriteLine(a.ToString().PadRight(8) + "if=" + viaIf + " if!=" + viaNot + " loop=" + viaLoop.Length + " ?:=" + ternary + " eq=" + nested + " chained=" + chained
        + " calls true=" + afterConditions + "+" + (Tri.TrueCalls - afterConditions) + " false=" + Tri.FalseCalls);
}

// Conversions to and from bool and bool?; mixed operands pick the user-defined operators through the implicit conversions.
bool yes = true, no = false;
bool? maybe = null;
Tri fromBool = yes, fromNullable = maybe, fromNull = null, mixed = Tri.Unknown | yes, mixed2 = no & Tri.Unknown, mixed3 = maybe ^ Tri.True, mixed4 = Tri.True & maybe;
Console.WriteLine("conversions: " + fromBool + " " + fromNullable + " " + fromNull + " " + mixed + " " + mixed2 + " " + mixed3 + " " + mixed4 + " " + (bool)Tri.True + " " + ((bool?)Tri.Unknown).HasValue + " " + (bool?)Tri.False
    + " " + (Tri)(yes & no) + " " + (yes ? Tri.True : null) + " " + (no ? Tri.True : maybe));
try { Console.WriteLine((bool)Tri.Unknown); } catch (InvalidOperationException e) { Console.WriteLine("explicit bool: " + e.Message); }

bool?[] flags = { false, null, true };
bool agrees = true, deMorgan = true, absorption = true, excludedMiddle = true;
foreach (bool? x in flags)
{
    excludedMiddle &= (bool)~((Tri)x | !(Tri)x == Tri.True) || !x.HasValue;
    foreach (bool? y in flags)
    {
        Tri a = x, b = y;
        agrees &= (a & b).Equals((Tri)(x & y)) && (a | b).Equals((Tri)(x | y)) && (a ^ b).Equals((Tri)(x ^ y)) && (!a).Equals((Tri)(!x));
        deMorgan &= (!(a & b)).Equals(!a | !b) && (!(a | b)).Equals(!a & !b);
        absorption &= (a | (a & b)).Equals(a) && (a & (a | b)).Equals(a);
    }
}
Console.WriteLine("laws: matches bool? logic=" + agrees + " deMorgan=" + deMorgan + " absorption=" + absorption + " excludedMiddle(definite only)=" + excludedMiddle);

Tri acc = Tri.True;
acc &= Tri.Unknown; Tri step1 = acc;
acc |= true; Tri step2 = acc;
acc ^= true; Tri step3 = acc;
acc |= maybe; Tri step4 = acc;
Tri? lifted = Tri.True, missing = null;
Tri? both = lifted & missing, either = lifted | lifted, flipped = !missing, xor = lifted ^ Tri.Unknown;
Console.WriteLine("compound: " + step1 + " " + step2 + " " + step3 + " " + step4 + " | lifted: " + (both.HasValue ? both.ToString() : "null") + " " + either + " " + (flipped?.ToString() ?? "null") + " " + xor + " " + (missing ?? Tri.Unknown)
    + " " + lifted.Equals(Tri.True) + " " + lifted.GetValueOrDefault().Equals(default(Tri)) + " " + default(Tri));

// An access policy over incomplete data: allowed = (admin || owner) && !suspended, evaluated lazily.
var users = new (string Name, bool? Admin, bool? Owner, bool? Suspended)[]
{
    ("root", true, false, false), ("ann", false, true, null), ("bob", null, null, false), ("cat", false, false, null), ("dan", true, null, true), ("eve", null, true, false), ("fay", false, null, null),
};
var verdicts = new List<(string Name, Tri Allowed)>();
foreach (var user in users)
{
    Tri.TrueCalls = Tri.FalseCalls = 0;
    Tri allowed = (Probe("a", user.Admin) || Probe("o", user.Owner)) && !Probe("s", user.Suspended);
    verdicts.Add((user.Name, allowed));
    string decision = allowed ? "grant" : !allowed ? "deny" : "review";
    Console.WriteLine("policy " + user.Name.PadRight(5) + allowed.ToString().PadRight(8) + decision.PadRight(7) + "read=" + Drain() + " operator calls=" + Tri.TrueCalls + "/" + Tri.FalseCalls);
}
Console.WriteLine("summary: " + string.Join(" ", verdicts.GroupBy(v => v.Allowed).OrderBy(g => g.Key.Rank).Select(g => g.Key + "=" + string.Join("+", g.Select(v => v.Name))))
    + " | definite grants: " + verdicts.Count(v => (bool)~v.Allowed) + " needs review: " + verdicts.Count(v => v.Allowed | Tri.Unknown ? false : !(!v.Allowed ? true : false))
    + " all=" + verdicts.Aggregate(Tri.True, (sum, v) => sum & v.Allowed) + " any=" + verdicts.Aggregate(Tri.False, (sum, v) => sum | v.Allowed) + " parity=" + verdicts.Aggregate(Tri.False, (sum, v) => sum ^ ~v.Allowed));

public readonly struct Tri : IEquatable<Tri>
{
    private readonly sbyte state; // -1 = false, 0 = unknown, +1 = true
    private Tri(int state) { this.state = (sbyte)state; }
    public static readonly Tri False = new Tri(-1), Unknown = new Tri(0), True = new Tri(1);
    public static int TrueCalls, FalseCalls;

    public int Rank => state;
    public char Symbol => state < 0 ? 'F' : state > 0 ? 'T' : '?';
    public Tri Implies(Tri other) => !this | other;

    public static implicit operator Tri(bool value) => value ? True : False;
    public static implicit operator Tri(bool? value) => value.HasValue ? value.GetValueOrDefault() : Unknown;
    public static explicit operator bool(Tri value) => value.state != 0 ? value.state > 0 : throw new InvalidOperationException("unknown has no boolean value");
    public static explicit operator bool?(Tri value) => value.state == 0 ? null : value.state > 0;

    public static bool operator true(Tri value) { TrueCalls++; return value.state > 0; }
    public static bool operator false(Tri value) { FalseCalls++; return value.state < 0; }
    public static Tri operator &(Tri a, Tri b) => new Tri(Math.Min(a.state, b.state));
    public static Tri operator |(Tri a, Tri b) => new Tri(Math.Max(a.state, b.state));
    public static Tri operator ^(Tri a, Tri b) => new Tri(-a.state * b.state);
    public static Tri operator !(Tri a) => new Tri(-a.state);
    public static Tri operator ~(Tri a) => new Tri(a.state > 0 ? 1 : -1);
    public static Tri operator ==(Tri a, Tri b) => !(a ^ b);
    public static Tri operator !=(Tri a, Tri b) => a ^ b;

    public bool Equals(Tri other) => state == other.state;
    public override bool Equals(object obj) => obj is Tri other && Equals(other);
    public override int GetHashCode() => state;
    public override string ToString() => state < 0 ? "False" : state > 0 ? "True" : "Unknown";
}
