using System.Globalization;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

if (args.Length != 1 || Environment.Version.ToString() != "10.0.5")
    throw new InvalidOperationException("Use .NET 10.0.5 and provide the output JSON path.");

static string ReadField(string name) => name switch
{
    nameof(Boolean.TrueString) => Boolean.TrueString,
    nameof(Boolean.FalseString) => Boolean.FalseString,
    _ => throw new ArgumentException("Unknown Boolean string field.", nameof(name))
};

static object CaptureField(string name, string literal)
{
    string value = ReadField(name);
    string copy = new(value.ToCharArray());
    var field = typeof(Boolean).GetField(name, BindingFlags.Public | BindingFlags.Static)!;
    string reflected = (string)field.GetValue(null)!;
    bool repeatedSameReference = Object.ReferenceEquals(value, ReadField(name));
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();
    return new
    {
        name,
        value,
        length = value.Length,
        codeUnits = value.Select(character => (int)character).ToArray(),
        literalSameReference = Object.ReferenceEquals(value, literal),
        reflectedSameReference = Object.ReferenceEquals(value, reflected),
        repeatedSameReference,
        sameReferenceAfterCollection = Object.ReferenceEquals(value, ReadField(name)),
        isInternedSameReference = Object.ReferenceEquals(value, String.IsInterned(value)),
        copyEqual = String.Equals(value, copy, StringComparison.Ordinal),
        copySameReference = Object.ReferenceEquals(value, copy),
        copyIsInternedSameReference = Object.ReferenceEquals(value, String.IsInterned(copy)),
        internCopySameReference = Object.ReferenceEquals(value, String.Intern(copy))
    };
}

static object[] CaptureCultures()
{
    var originalCulture = CultureInfo.CurrentCulture;
    var originalUiCulture = CultureInfo.CurrentUICulture;
    string firstTrue = Boolean.TrueString;
    string firstFalse = Boolean.FalseString;
    var rows = new List<object>();
    try
    {
        foreach (string name in new[] { "", "en-US", "tr-TR", "az-Latn-AZ" })
        {
            var culture = CultureInfo.GetCultureInfo(name);
            CultureInfo.CurrentCulture = culture;
            CultureInfo.CurrentUICulture = culture;
            rows.Add(new
            {
                culture = culture.Name,
                trueValue = Boolean.TrueString,
                falseValue = Boolean.FalseString,
                sameTrueReference = Object.ReferenceEquals(firstTrue, Boolean.TrueString),
                sameFalseReference = Object.ReferenceEquals(firstFalse, Boolean.FalseString)
            });
        }
    }
    finally
    {
        CultureInfo.CurrentCulture = originalCulture;
        CultureInfo.CurrentUICulture = originalUiCulture;
    }
    return rows.ToArray();
}

var type = typeof(Boolean);
var flags = BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;
var metadata = type.GetFields(flags).OrderBy(field => field.Name, StringComparer.Ordinal).Select(field => new
{
    kind = "field",
    name = field.Name,
    owner = field.DeclaringType!.FullName,
    result = field.FieldType.FullName,
    isPublic = field.IsPublic,
    isStatic = field.IsStatic,
    readOnly = field.IsInitOnly,
    literal = field.IsLiteral,
    propertyExists = type.GetProperty(field.Name, flags) is not null,
    getterExists = type.GetMethod("get_" + field.Name, flags) is not null
}).ToArray();
var assembly = type.Assembly.GetName();
var result = new
{
    sdk = "10.0.201",
    runtime = Environment.Version.ToString(),
    frameworkDescription = RuntimeInformation.FrameworkDescription,
    osDescription = RuntimeInformation.OSDescription,
    processArchitecture = RuntimeInformation.ProcessArchitecture.ToString(),
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("Program.cs"))),
    projectSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes("BooleanStringFieldsReference.csproj"))),
    assemblyIdentity = new
    {
        name = assembly.Name,
        version = assembly.Version!.ToString(),
        culture = assembly.CultureName ?? "",
        publicKeyToken = Convert.ToHexStringLower(assembly.GetPublicKeyToken()!)
    },
    assemblySha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(type.Assembly.Location))),
    metadataSource = "All public declared Boolean fields obtained through System.Reflection; fields remain distinct from properties.",
    referenceSource = "https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Boolean.cs",
    metadata,
    rows = new[] { CaptureField(nameof(Boolean.FalseString), "False"), CaptureField(nameof(Boolean.TrueString), "True") },
    cultures = CaptureCultures(),
    observations = new
    {
        keywordTrueSameReference = Object.ReferenceEquals(bool.TrueString, Boolean.TrueString),
        keywordFalseSameReference = Object.ReferenceEquals(bool.FalseString, Boolean.FalseString),
        distinctFieldReferences = !Object.ReferenceEquals(Boolean.TrueString, Boolean.FalseString),
        distinctFieldValues = !String.Equals(Boolean.TrueString, Boolean.FalseString, StringComparison.Ordinal)
    }
};
File.WriteAllText(args[0], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }) + "\n");
