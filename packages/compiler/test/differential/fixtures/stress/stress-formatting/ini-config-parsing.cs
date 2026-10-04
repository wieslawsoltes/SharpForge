using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

const string source = """
    ; service configuration
    [Server]
    Port = 8080
    Mask = 0xFF00
    Timeout = 1.5e3
    Ratio=0.125
    Budget = (1,250.75)
    Flags = Read, Write , Execute
    Level = warning
    Name = " edge node "   # quoted value keeps its spaces

    [limits]
    MaxUsers = 1,000,000
    Retries = +3
    Burst = 300
    Mode = 6
    Bits = 1011_0010
    broken line without equals
    Empty =
    [Server]
    port = 9090
    """;

var config = IniFile.Parse(source);
var inv = CultureInfo.InvariantCulture;
Console.WriteLine($"sections: {string.Join(", ", config.Sections)}; warnings: {string.Join(" / ", config.Warnings)}");
Console.WriteLine("port " + config.Get<int>("server", "PORT") + " timeout " + config.Get<double>("Server", "Timeout").ToString("F1", inv) + " ratio " + config.Get<decimal>("Server", "Ratio").ToString(inv)
    + " retries " + config.Get<sbyte>("limits", "retries") + " name [" + config["Server", "Name"] + "] empty [" + config["limits", "Empty"] + "] missing " + (config["limits", "Nope"] ?? "null") + " default " + config.Get("limits", "Nope", 42L));

Console.WriteLine("-- NumberStyles");
string mask = config["Server", "Mask"];
int maskValue = int.Parse(mask.AsSpan(2), NumberStyles.HexNumber, inv);
Console.WriteLine(maskValue + " " + Convert.ToInt32(mask, 16) + " " + int.Parse("ff", NumberStyles.AllowHexSpecifier, inv) + " " + long.Parse("7FFFFFFFFFFFFFFF", NumberStyles.HexNumber, inv) + " " + int.Parse("FFFFFFFF", NumberStyles.HexNumber, inv).ToString(inv) + " " + uint.Parse("FFFFFFFF", NumberStyles.HexNumber, inv));
Console.WriteLine(int.Parse(config["limits", "MaxUsers"], NumberStyles.AllowThousands, inv) + " " + decimal.Parse(config["Server", "Budget"], NumberStyles.Number | NumberStyles.AllowParentheses, inv).ToString(inv)
    + " " + int.Parse(" 42 ", NumberStyles.Integer, inv) + " " + int.Parse("1e3", NumberStyles.AllowExponent, inv) + " " + double.Parse("-1.5E-3", NumberStyles.Float, inv).ToString(inv) + " " + decimal.Parse("1e2", NumberStyles.Float, inv).ToString(inv)
    + " " + int.Parse("12-", NumberStyles.AllowTrailingSign, inv).ToString(inv) + " " + double.Parse("$1,234.50", NumberStyles.Currency, new NumberFormatInfo { CurrencySymbol = "$" }).ToString("F2", inv)
    + " " + int.Parse(config["limits", "Bits"].Replace("_", ""), NumberStyles.BinaryNumber, inv) + " " + double.Parse(".5", inv).ToString(inv) + " " + double.Parse("5.", inv).ToString(inv));
(string Text, NumberStyles Style)[] probes =
{
    ("12", NumberStyles.None), ("-12", NumberStyles.None), (" 12", NumberStyles.None), ("1,2", NumberStyles.Integer), ("1.0", NumberStyles.Integer), ("1.0", NumberStyles.Float), ("1.5", NumberStyles.Float),
    ("0x1F", NumberStyles.HexNumber), ("1F", NumberStyles.HexNumber), ("(7)", NumberStyles.AllowParentheses), ("2147483648", NumberStyles.Integer), ("", NumberStyles.Any), ("٣", NumberStyles.Integer),
};
Console.WriteLine(string.Join(" ", probes.Select(p => int.TryParse(p.Text, p.Style, inv, out int n) ? n.ToString(inv) : "x")));
Console.WriteLine(string.Join(" ", byte.TryParse(config["limits", "Burst"], out byte burst), burst, sbyte.TryParse("-128", NumberStyles.Integer, inv, out sbyte low), low.ToString(inv), ushort.TryParse("65536", out _), ulong.TryParse("18446744073709551615", out ulong top), top,
    long.TryParse("-9223372036854775808", NumberStyles.Integer, inv, out long bottom), bottom.ToString(inv), char.TryParse("ab", out _), char.TryParse("z", out char z), z, bool.TryParse(" TRUE ", out bool yes), yes, bool.TryParse("yes", out _), nint.Parse("123", inv)));
Console.WriteLine(string.Join(" ", new[] { "NaN", "Infinity", "-Infinity", "1e400", "-0", "1_000", "0x10", "1,5", "١٢" }.Select(t => double.TryParse(t, NumberStyles.Float, inv, out double d) ? d.ToString("R", inv) : "x"))
    + " " + float.Parse("16777217", inv).ToString("F0", inv) + " " + decimal.TryParse("79228162514264337593543950336", NumberStyles.Number, inv, out _) + " " + decimal.Parse("0.10", inv).ToString(inv));
foreach (string bad in new[] { "abc", "99999999999", null })
{
    try { Console.WriteLine(int.Parse(bad, inv)); }
    catch (Exception e) when (e is FormatException or OverflowException or ArgumentNullException) { Console.WriteLine("int.Parse(" + (bad ?? "null") + ") -> " + e.GetType().Name); }
}

Console.WriteLine("-- Convert with a base");
int mode = config.Get<int>("limits", "Mode");
Console.WriteLine(string.Join(" ", Convert.ToString(mode, 2), Convert.ToString(mode, 2).PadLeft(8, '0'), Convert.ToString(255, 16), Convert.ToString(255, 8), Convert.ToString(-1, 16), Convert.ToString((short)-2, 2), Convert.ToString((byte)200, 2), Convert.ToString(long.MaxValue, 16),
    Convert.ToInt32("1010", 2), Convert.ToInt32("777", 8), Convert.ToInt32("7fffffff", 16), Convert.ToInt32("0x1A", 16), Convert.ToInt64("ffffffff", 16), Convert.ToByte("ff", 16), Convert.ToUInt16("1111111111111111", 2), Convert.ToInt32("80000000", 16).ToString(inv), Convert.ToInt16("8000", 16).ToString(inv)));
try { Convert.ToInt32("12", 7); } catch (ArgumentException) { Console.WriteLine("base must be 2, 8, 10 or 16"); }
try { Convert.ToByte("100", 16); } catch (OverflowException) { Console.WriteLine("0x100 does not fit a byte"); }
Console.WriteLine(string.Join(" ", Convert.ToInt32("42", inv), Convert.ToInt32(2.5), Convert.ToInt32(3.5), Convert.ToInt32(-2.5).ToString(inv), Convert.ToInt32('A'), Convert.ToInt32(true), Convert.ToChar(97), Convert.ToBoolean("FALSE"), Convert.ToDouble("1e2", inv).ToString(inv), Convert.ToDecimal("12.50", inv).ToString(inv), Convert.ToString(12.5, inv), Convert.ToString(true), Convert.ToByte(255.4)));

Console.WriteLine("-- enums");
Access flags = config.GetEnum<Access>("Server", "Flags");
Level level = config.GetEnum<Level>("Server", "Level");
Console.WriteLine($"{flags} | {flags:G} | {flags:D} | {flags:X} | {flags:F} | {level} | {level:D} | {level:X} | {level:F} | {(Level)7} | {(Level)7:F} | {(Access)9:G} | {(Access)9:F} | {Access.All} | {Access.None} | {(Access)0:F} | {(Access)16}");
Console.WriteLine(string.Join(" ", Enum.Parse<Access>("write"u8.Length == 5 ? "Write" : "?"), Enum.Parse<Access>("3"), Enum.Parse(typeof(Level), "ERROR", true), Enum.TryParse("Execute,Read", out Access parsed), parsed, Enum.TryParse("execute", out Access strict), strict, Enum.TryParse("execute", true, out Access loose), loose,
    Enum.TryParse(" Info ", out Level trimmed), trimmed, Enum.TryParse("Fatal", out Level unknown), unknown, Enum.TryParse("42", out Level numeric), numeric, Enum.IsDefined(numeric), Enum.IsDefined(typeof(Level), "Info"), Enum.IsDefined((Access)3)));
Console.WriteLine(string.Join(",", Enum.GetNames<Access>()) + " " + string.Join(",", Enum.GetValues<Level>().Select(l => (byte)l)) + " " + Enum.GetName(Level.Error) + " " + (Enum.GetName((Level)9) ?? "null") + " " + Enum.GetUnderlyingType(typeof(Level)).Name + " " + Enum.Format(typeof(Access), (Access)5, "G")
    + " " + Access.Write.ToString("X") + " " + ((Level)Enum.ToObject(typeof(Level), 2)) + " " + flags.HasFlag(Access.Write) + " " + (flags & ~Access.Write) + " " + (Access.Read ^ Access.All) + " " + Enum.Parse<Level>(mode % 3 == 0 ? "0" : "1"));
try { Enum.Parse<Level>("verbose"); } catch (ArgumentException) { Console.WriteLine("unknown enum name rejected"); }

[Flags] public enum Access { None = 0, Read = 1, Write = 2, Execute = 4, All = Read | Write | Execute }
public enum Level : byte { Info, Warning, Error }

public sealed class IniFile
{
    private readonly Dictionary<string, Dictionary<string, string>> sections = new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase);
    public List<string> Warnings { get; } = new List<string>();
    public IEnumerable<string> Sections => sections.Select(s => s.Key + "(" + s.Value.Count + ")");
    public string this[string section, string key] => sections.TryGetValue(section, out var values) && values.TryGetValue(key, out string value) ? value : null;

    public static IniFile Parse(string text)
    {
        var file = new IniFile();
        Dictionary<string, string> current = null;
        string[] lines = text.Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        for (int number = 0; number < lines.Length; number++)
        {
            string line = lines[number];
            if (line.StartsWith(';')) continue;
            if (line.StartsWith('[') && line.EndsWith(']'))
            {
                string name = line.Trim('[', ']');
                if (!file.sections.TryGetValue(name, out current)) file.sections.Add(name, current = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase));
                continue;
            }
            int equals = line.IndexOf("=", StringComparison.Ordinal), comment = line.IndexOf(" #", StringComparison.Ordinal);
            if (equals <= 0 || current == null) { file.Warnings.Add($"entry {number + 1}: '{line[..Math.Min(line.Length, 11)]}'"); continue; }
            string value = (comment > equals ? line[(equals + 1)..comment] : line[(equals + 1)..]).Trim();
            if (value.Length >= 2 && value[0] == '"' && value[^1] == '"') value = value[1..^1];
            if (!current.TryAdd(line[..equals].TrimEnd(), value)) { current[line[..equals].TrimEnd()] = value; file.Warnings.Add("override " + line[..equals].TrimEnd().ToLowerInvariant()); }
        }
        return file;
    }

    public T Get<T>(string section, string key) where T : IParsable<T> => T.Parse(this[section, key], CultureInfo.InvariantCulture);
    public T Get<T>(string section, string key, T fallback) where T : ISpanParsable<T> => T.TryParse(this[section, key].AsSpan(), CultureInfo.InvariantCulture, out T value) ? value : fallback;
    public TEnum GetEnum<TEnum>(string section, string key) where TEnum : struct, Enum => Enum.Parse<TEnum>(this[section, key], ignoreCase: true);
}
