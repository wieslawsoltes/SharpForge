using System;
using System.Collections.Generic;
using System.Linq;

int[][] pascal = new int[7][];
for (int n = 0; n < pascal.Length; n++)
{
    pascal[n] = new int[n + 1];
    pascal[n][0] = pascal[n][^1] = 1;
    for (int k = 1; k < n; k++) pascal[n][k] = pascal[n - 1][k - 1] + pascal[n - 1][k];
}
foreach (int[] line in pascal[3..]) Console.WriteLine(new string(' ', (pascal.Length - line.Length) * 2) + string.Join("   ", line));
Console.WriteLine(pascal.Sum(line => line.Length) + " " + pascal[^1][3] + " " + pascal[6][2..^2].Sum() + " " + string.Join(",", pascal.Select(line => line.Sum())));

int[,] solved =
{
    { 5, 3, 4, 6, 7, 8, 9, 1, 2 }, { 6, 7, 2, 1, 9, 5, 3, 4, 8 }, { 1, 9, 8, 3, 4, 2, 5, 6, 7 },
    { 8, 5, 9, 7, 6, 1, 4, 2, 3 }, { 4, 2, 6, 8, 5, 3, 7, 9, 1 }, { 7, 1, 3, 9, 2, 4, 8, 5, 6 },
    { 9, 6, 1, 5, 3, 7, 2, 8, 4 }, { 2, 8, 7, 4, 1, 9, 6, 3, 5 }, { 3, 4, 5, 2, 8, 6, 1, 7, 9 },
};
var swapped = (int[,])solved.Clone();
(swapped[0, 0], swapped[0, 1]) = (swapped[0, 1], swapped[0, 0]);
var holed = (int[,])solved.Clone();
holed[4, 4] = 0;
var boxClash = (int[,])solved.Clone();
(boxClash[3, 0], boxClash[4, 0], boxClash[3, 1], boxClash[4, 1]) = (boxClash[4, 1], boxClash[3, 1], boxClash[4, 0], boxClash[3, 0]);
int[][,] boards = { solved, swapped, holed, boxClash };
foreach (var board in boards) Console.WriteLine(Sudoku.Validate(board));

string[][] teams = { new[] { "mia", "bo", "alexander" }, Array.Empty<string>(), new[] { "zed" }, new[] { "kim", "al" } };
Array.Sort(teams, (a, b) => a.Length != b.Length ? b.Length.CompareTo(a.Length) : string.CompareOrdinal(a.FirstOrDefault(), b.FirstOrDefault()));
foreach (var team in teams) Array.Sort(team, (a, b) => a.Length - b.Length);
Console.WriteLine(string.Join(" | ", teams.Select(team => team.Length + ":" + string.Join(",", team))) + " " + ReferenceEquals(teams[^1], Array.Empty<string>()));

string[] names = { "delta", "alpha", "echo", "charlie", "bravo" };
int[] scores = { 40, 10, 50, 30, 20 };
Array.Sort(scores, names);
int found = Array.BinarySearch(scores, 30), missing = Array.BinarySearch(scores, 35);
Console.WriteLine(string.Join(",", names) + " " + found + " " + missing + " " + ~missing + " " + Array.IndexOf(names, "echo") + " " + Array.IndexOf(names, "zulu") + " " + Array.LastIndexOf(scores, 10));
Array.Sort(names, 1, 3, StringComparer.OrdinalIgnoreCase);
Array.Reverse(names, 0, 2);
Array.Sort(names, scores, Comparer<string>.Create((a, b) => b.Length != a.Length ? b.Length - a.Length : string.CompareOrdinal(a, b)));
Console.WriteLine(string.Join(",", names) + " " + string.Join(",", scores));

int[] buffer = new int[8];
Array.Fill(buffer, 7);
Array.Fill(buffer, -1, 2, 3);
Array.Copy(scores, 1, buffer, 5, 3);
Array.Resize(ref buffer, 10);
int[] shrunk = (int[])buffer.Clone();
Array.Resize(ref shrunk, 3);
Array.Clear(buffer, 0, 2);
Array.Reverse(buffer);
Console.WriteLine(string.Join(",", buffer) + " | " + string.Join(",", shrunk) + " | " + Array.Find(buffer, v => v > 20) + " " + Array.FindLast(buffer, v => v > 20) + " " + Array.FindIndex(buffer, v => v < 0) + " " + Array.FindLastIndex(buffer, v => v < 0)
    + " " + string.Join("/", Array.FindAll(buffer, v => v % 2 != 0)) + " " + Array.Exists(buffer, v => v == 7) + " " + Array.TrueForAll(buffer, v => v >= -1) + " " + (Array.Find(names, n => n.Length > 9) is null));
string[] labels = Array.ConvertAll(buffer, v => v < 0 ? "neg" : v.ToString("D2"));
int total = 0;
Array.ForEach(buffer, v => total += v);
Console.WriteLine(string.Join(" ", labels) + " total " + total + " " + Array.Empty<int>().Length + " " + ReferenceEquals(Array.Empty<int>(), Array.Empty<int>()) + " " + Array.AsReadOnly(shrunk).Count);

Index last = ^1, third = 2;
Range middle = 1..^1, head = ..3, tail = ^2.., all = ..;
var (offset, length) = middle.GetOffsetAndLength(names.Length);
Range computed = third..(names.Length - 1);
Console.WriteLine($"{names[last]} {names[third]} {last.IsFromEnd} {last.Value} {last.GetOffset(names.Length)} {offset}+{length} {string.Join(",", names[middle])} {string.Join(",", names[head])} {string.Join(",", names[tail])} {names[all].Length} {middle} {computed} {names[computed].Length} {middle.End.Equals(last)} {Range.StartAt(3).Equals(3..)}");
var window = new Window<string>(names, 1..4);
window[^1] = window[0].ToUpperInvariant();
var inner = window[1..];
Console.WriteLine($"{window.Count} {window[0]} {window[^1]} {inner.Count} {inner[^1]} {string.Join(",", names)} {window[..^3].Count}");

Account[] accounts = { new("a", 10), new("b", 20), new("c", 30) };
accounts[1].Balance += 5;
accounts[^1].Deposit(70);
foreach (var account in accounts) account.Deposit(1000);
Array.ForEach(accounts, account => account.Balance = 0);
ref Account first = ref accounts[0];
first.Deposit(1);
for (int i = 0; i < accounts.Length; i++) accounts[i].Owner += i;
Account[][] branches = { accounts, new[] { accounts[0] } };
branches[1][0].Balance = -1;
Console.WriteLine(string.Join(" ", accounts.Select(a => a.Owner + "=" + a.Balance)) + " " + branches[1][0].Balance + " " + branches.Sum(b => b.Length));

object[] objects = names;
IReadOnlyList<object> readOnly = teams[0];
try { objects[0] = 42; }
catch (ArrayTypeMismatchException) { Console.WriteLine("covariant store rejected " + (objects is string[]) + " " + objects.GetType().GetElementType().Name + " " + readOnly.Count + " " + (objects[0] is string s ? s.Length : -1)); }
objects[0] = "replaced";
Console.WriteLine(names[0] + " " + (teams is object[][]) + " " + (pascal is object[]) + " " + (((object)scores) is long[]) + " " + (pascal[1] is [1, 1]));

public struct Account(string owner, int balance)
{
    public string Owner = owner;
    public int Balance = balance;
    public void Deposit(int amount) => Balance += amount;
}

public sealed class Window<T>(T[] items, Range range)
{
    private readonly int _start = range.GetOffsetAndLength(items.Length).Offset;
    public int Count { get; } = range.GetOffsetAndLength(items.Length).Length;
    public T this[Index index] { get => items[_start + index.GetOffset(Count)]; set => items[_start + index.GetOffset(Count)] = value; }
    public Window<T> this[Range slice]
    {
        get
        {
            var (offset, length) = slice.GetOffsetAndLength(Count);
            return new Window<T>(items, (_start + offset)..(_start + offset + length));
        }
    }
}

public static class Sudoku
{
    public static string Validate(int[,] board)
    {
        bool[] seen = new bool[10];
        for (int unit = 0; unit < 27; unit++)
        {
            Array.Clear(seen);
            for (int i = 0; i < 9; i++)
            {
                var (row, column) = (unit / 9) switch { 0 => (unit, i), 1 => (i, unit - 9), _ => ((unit - 18) / 3 * 3 + i / 3, (unit - 18) % 3 * 3 + i % 3) };
                int digit = board[row, column];
                if (digit is < 1 or > 9) return $"incomplete at {row},{column}";
                if (seen[digit]) return $"{(unit / 9) switch { 0 => "row", 1 => "column", _ => "box" }} {unit % 9} repeats {digit}";
                seen[digit] = true;
            }
        }
        return "valid";
    }
}
