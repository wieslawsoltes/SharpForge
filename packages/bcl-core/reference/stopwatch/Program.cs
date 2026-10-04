using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
var type = typeof(Stopwatch);
var flags = BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;
var metadata = new List<object>();
string TypeName(Type value) => value.FullName ?? value.Name;
foreach (var member in type.GetMembers(flags).OrderBy(value => value.MemberType).ThenBy(value => value.ToString(), StringComparer.Ordinal))
{
    switch (member)
    {
        case FieldInfo field:
            metadata.Add(new { kind = "field", name = field.Name, result = TypeName(field.FieldType),
                owner = TypeName(field.DeclaringType!), isStatic = field.IsStatic,
                readOnly = field.IsInitOnly, literal = field.IsLiteral });
            break;
        case PropertyInfo property:
            metadata.Add(new { kind = "property", name = property.Name, result = TypeName(property.PropertyType),
                isStatic = property.GetMethod!.IsStatic, readOnly = property.SetMethod is null });
            break;
        case ConstructorInfo constructor:
            metadata.Add(new { kind = "constructor", name = constructor.Name, result = "System.Void", isStatic = false,
                parameters = constructor.GetParameters().Select(parameter => TypeName(parameter.ParameterType)).ToArray() });
            break;
        case MethodInfo method:
            metadata.Add(new { kind = "method", name = method.Name, result = TypeName(method.ReturnType), isStatic = method.IsStatic,
                parameters = method.GetParameters().Select(parameter => TypeName(parameter.ParameterType)).ToArray(),
                isVirtual = method.IsVirtual, baseOwner = method.GetBaseDefinition().DeclaringType!.FullName });
            break;
    }
}

var rows = new List<object>();
void Capture(long start, long end)
{
    TimeSpan elapsed = Stopwatch.GetElapsedTime(start, end);
    rows.Add(new {
        start = start.ToString(CultureInfo.InvariantCulture), end = end.ToString(CultureInfo.InvariantCulture),
        ticks = elapsed.Ticks.ToString(CultureInfo.InvariantCulture),
        totalMilliseconds = elapsed.TotalMilliseconds.ToString("R", CultureInfo.InvariantCulture),
        totalSeconds = elapsed.TotalSeconds.ToString("R", CultureInfo.InvariantCulture),
        text = elapsed.ToString("c", CultureInfo.InvariantCulture)
    });
}

long[] elapsedTimestamps = [
    0, 1, 49, 50, 99, 100, 101, 999, 1000, 1001, 99999, 100000, 999999, 1000000, 1000001,
    999999999, 1000000000, 1500000000, 86400000000000, 9007199254740991, 9007199254740992,
    9007199254740993, 123456789012345678, long.MaxValue, long.MinValue
];
foreach (long elapsed in elapsedTimestamps)
{
    Capture(0, elapsed);
    if (elapsed != long.MinValue && elapsed != 0) Capture(0, -elapsed);
}
Capture(9007199254740992, 9007199254740993);
Capture(9007199254740993, 9007199256240993);
Capture(long.MaxValue, long.MinValue);
Capture(long.MinValue, long.MaxValue);
Capture(-1000, 1000);
Capture(1000, -1000);

var watch = new Stopwatch();
bool initiallyStopped = !watch.IsRunning;
bool initiallyZero = watch.ElapsedTicks == 0 && watch.ElapsedMilliseconds == 0 && watch.Elapsed.Ticks == 0;
string initialText = watch.ToString();
watch.Stop();
bool stoppingStoppedIsNoop = watch.ElapsedTicks == 0 && !watch.IsRunning;
watch.Start();
bool startRuns = watch.IsRunning;
watch.Start();
bool repeatedStartRuns = watch.IsRunning;
watch.Stop();
long stoppedTicks = watch.ElapsedTicks;
watch.Stop();
bool repeatedStopPreservesElapsed = stoppedTicks == watch.ElapsedTicks && !watch.IsRunning;
watch.Restart();
bool restartRuns = watch.IsRunning;
watch.Reset();
bool resetClearsState = !watch.IsRunning && watch.ElapsedTicks == 0 && watch.ElapsedMilliseconds == 0;
string resetText = watch.ToString();
var started = Stopwatch.StartNew();
bool startNewRuns = started.IsRunning;
started.Stop();
long timestamp = Stopwatch.GetTimestamp();
bool timestampMonotonic = Stopwatch.GetTimestamp() >= timestamp;
bool elapsedSinceNonnegative = Stopwatch.GetElapsedTime(timestamp) >= TimeSpan.Zero;

var assembly = type.Assembly.GetName();
var result = new {
    sdk = "10.0.201", runtime = Environment.Version.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))),
    referenceAssembly = assembly.Name,
    assemblyIdentity = new { name = assembly.Name, version = assembly.Version!.ToString(),
        culture = assembly.CultureName ?? "", publicKeyToken = Convert.ToHexStringLower(assembly.GetPublicKeyToken()!) },
    assemblySha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(type.Assembly.Location))),
    metadataSource = "Public declared runtime metadata obtained through System.Reflection; fields remain distinct from properties.",
    frequency = Stopwatch.Frequency.ToString(CultureInfo.InvariantCulture), isHighResolution = Stopwatch.IsHighResolution,
    metadata, rows,
    observations = new { initiallyStopped, initiallyZero, initialText, stoppingStoppedIsNoop, startRuns,
        repeatedStartRuns, repeatedStopPreservesElapsed, restartRuns, resetClearsState, resetText,
        startNewRuns, timestampMonotonic, elapsedSinceNonnegative }
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");
