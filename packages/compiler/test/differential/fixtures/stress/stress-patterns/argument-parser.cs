using System;
using System.Collections.Generic;
using System.Linq;

var runs = new string[][]
{
    new[] { "build", "--verbose", "-o", "out", "a.cs", "b.cs" },
    new[] { "run", "--", "x", "-y" },
    new[] { "help" },
    new[] { "help", "build" },
    new[] { "help", "build", "more" },
    new string[0],
    new[] { "test", "--filter=Fast", "-j4", "--no-color", "--retry=3" },
    new[] { "build", "-o" },
    new[] { "build", "--output", "-v" },
    new[] { "deploy", "prod", "now" },
    new[] { "-v", "build" },
    new[] { "test", "-j99", "unit" },
    new[] { "test", "-vq", "--color=Yes", "--strict=OFF", "--mode=fast" },
    new[] { "run", "-x", "--=3" },
    null,
};
foreach (var run in runs)
    Console.WriteLine((run is null ? "<null>" : string.Join(' ', run)) + " => " + Cli.Parse(run));

Console.WriteLine(string.Join("; ", Cli.Show(true), Cli.Show(3), Cli.Show(12), Cli.Show(""), Cli.Show("x"), Cli.Show(new List<string> { "a", "b" }),
    Cli.Show(new string[0]), Cli.Show<bool?>(null), Cli.Show<bool?>(false), Cli.Show(2.5)));
Console.WriteLine(string.Join(",", new[] { "YES", "on", "True", "no", "Off", "0", "1", "maybe", "", "enabledenabledenabled" }.Select(Cli.Truth)));

public sealed class Options
{
    public Options(string command) { Command = command; }
    public string Command { get; }
    public bool Verbose, Quiet;
    public bool? Color;
    public int Jobs = 1;
    public string Output;
    public List<string> Inputs { get; } = new List<string>();
    public SortedDictionary<string, string> Settings { get; } = new SortedDictionary<string, string>();

    public override string ToString() =>
        $"{Command}[v={Verbose} q={Quiet} color={Cli.Show(Color)} jobs={Jobs} out={Output ?? "-"}] in=({string.Join(",", Inputs)}) set=({string.Join(",", Settings.Select(p => p.Key + ":" + p.Value))})";
}

public static class Cli
{
    public static string Parse(string[] args)
    {
        switch (args)
        {
            case []:
                return "usage";
            case ["help" or "-h" or "--help"]:
                return "general help";
            case ["help", var topic]:
                return "help for " + topic;
            case ["help", _, ..]:
                return "error: too many topics";
            case [['-', ..] flag, ..]:
                return "error: expected a command before " + flag;
            case [var command and ("build" or "run" or "test"), .. var rest]:
                var options = new Options(command);
                return ParseRest(rest, options) is { } problem ? "error: " + problem : options.ToString();
            case [var unknown, .. { Length: var extra }]:
                return $"error: unknown command {unknown} (+{extra} args)";
        }
        return "error: no arguments";
    }

    private static string ParseRest(ReadOnlySpan<string> rest, Options options)
    {
        while (true)
        {
            switch (rest)
            {
                case []:
                    return null;
                case ["--", .. var positional]:
                    foreach (var item in positional) options.Inputs.Add(item);
                    return null;
                case ["-o" or "--output", var path, .. var tail] when path is not ['-', ..]:
                    options.Output = path;
                    rest = tail;
                    break;
                case ["-o" or "--output", ..]:
                    return "missing value for output";
                case [var argument, .. var tail]:
                    if (Apply(argument, options) is string failure) return failure;
                    rest = tail;
                    break;
            }
        }
    }

    private static string Apply(ReadOnlySpan<char> argument, Options options)
    {
        switch (argument)
        {
            case "--verbose" or "-v":
                options.Verbose = true;
                return null;
            case "--no-color":
                options.Color = false;
                return null;
            case ['-', 'j', .. var digits] when int.TryParse(digits, out int jobs) && jobs is > 0 and <= 64:
                options.Jobs = jobs;
                return null;
            case ['-', 'j', ..]:
                return "bad job count '" + argument[2..].ToString() + "'";
            case ['-', '-', .. var body] when body.IndexOf('=') is > 0 and var split:
                string key = body[..split].ToString(), value = body[(split + 1)..].ToString();
                if (key == "color") options.Color = Truth(value) switch { 1 => true, 0 => false, _ => null };
                else options.Settings[key] = Truth(value) is var truth and >= 0 ? (truth == 1 ? "on" : "off") : value;
                return null;
            case ['-', >= 'a' and <= 'z', >= 'a' and <= 'z', ..]:
                foreach (char letter in argument[1..])
                {
                    if (letter is 'v') options.Verbose = true;
                    else if (letter is 'q') options.Quiet = true;
                    else return "unknown flag '" + letter + "' in cluster";
                }
                return null;
            case ['-', ..]:
                return "unknown option " + argument.ToString();
            default:
                options.Inputs.Add(argument.ToString());
                return null;
        }
    }

    public static int Truth(string text)
    {
        Span<char> lowered = text.Length <= 16 ? stackalloc char[text.Length] : new char[text.Length];
        for (int i = 0; i < text.Length; i++) lowered[i] = char.ToLowerInvariant(text[i]);
        if (lowered is "yes" or "on" or "true" or "1") return 1;
        return lowered switch
        {
            "no" or "off" or "false" or "0" => 0,
            [] => -2,
            { Length: > 16 } => -3,
            _ => -1,
        };
    }

    public static string Show<T>(T value) => value switch
    {
        bool flag => flag ? "on" : "off",
        int number and > 9 => "many(" + number + ")",
        int number => "#" + number,
        string { Length: 0 } => "<empty>",
        string text => "'" + text + "'",
        IReadOnlyCollection<string> { Count: var count and > 0 } list => count + " items from " + list.First(),
        IReadOnlyCollection<string> => "no items",
        null => "auto",
        _ => typeof(T).Name,
    };
}
