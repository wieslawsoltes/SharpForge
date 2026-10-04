using System.Reflection;
using System.Reflection.Emit;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Text.Json;

var cases = new[] {
    new Shape("SameFamilyAndAssembly", 2, 2),
    new Shape("SameAssembly", 3, 3),
    new Shape("SameFamily", 4, 4),
    new Shape("SameFamilyOrAssembly", 5, 5),
    new Shape("SamePublic", 6, 6),
    new Shape("WidenFamilyAndAssembly", 2, 4),
    new Shape("WidenAssembly", 3, 5),
    new Shape("WidenFamily", 4, 6),
    new Shape("PrivateBase", 1, 6),
    new Shape("NarrowPublic", 6, 4),
    new Shape("LateralFamily", 4, 3),
    new Shape("NarrowFamilyOrAssembly", 5, 4)
};
var builder = new PersistedAssemblyBuilder(new AssemblyName("StrictOverrides"), typeof(object).Assembly);
var module = builder.DefineDynamicModule("StrictOverrides");
foreach (var shape in cases)
{
    var root = module.DefineType($"Fixture.{shape.Name}Root", TypeAttributes.Public, typeof(object));
    var child = module.DefineType($"Fixture.{shape.Name}Child", TypeAttributes.Public, root);
    Define(root, shape.Parent, true);
    Define(child, shape.Child, false);
    root.CreateType();
    child.CreateType();
}
using var stream = new MemoryStream();
builder.Save(stream);
var bytes = stream.ToArray();
using var pe = new PEReader(new MemoryStream(bytes));
var metadata = pe.GetMetadataReader();
var tokens = new Dictionary<string, int>();
foreach (var handle in metadata.TypeDefinitions)
{
    var type = metadata.GetTypeDefinition(handle);
    foreach (var method in type.GetMethods())
        if (metadata.GetString(metadata.GetMethodDefinition(method).Name) == "M")
            tokens[metadata.GetString(type.Namespace) + "." + metadata.GetString(type.Name)] = MetadataTokens.GetToken(method);
}
var assembly = Assembly.Load(bytes);
var records = new List<object>();
foreach (var shape in cases)
{
    var declaringType = $"Fixture.{shape.Name}Child";
    var token = tokens[declaringType];
    try
    {
        var type = assembly.GetType(declaringType, true)!;
        var method = type.GetMethod("M", BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)!;
        var root = method.GetBaseDefinition();
        records.Add(new { token, name = "M", declaringType, parentAccess = shape.Parent, childAccess = shape.Child,
            baseToken = root.MetadataToken, baseType = root.DeclaringType!.FullName });
    }
    catch (Exception error) when (error is TypeLoadException or MethodAccessException)
    {
        records.Add(new { token, name = "M", declaringType, parentAccess = shape.Parent, childAccess = shape.Child,
            error = error.GetType().Name });
    }
}
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription,
    image = Convert.ToBase64String(bytes), records }));

static void Define(TypeBuilder owner, int access, bool newSlot)
{
    var flags = (MethodAttributes)access | MethodAttributes.Virtual | MethodAttributes.HideBySig;
    if (newSlot) flags |= MethodAttributes.NewSlot | MethodAttributes.CheckAccessOnOverride;
    var method = owner.DefineMethod("M", flags, CallingConventions.Standard | CallingConventions.HasThis, typeof(int), [typeof(int)]);
    var il = method.GetILGenerator();
    il.Emit(OpCodes.Ldc_I4_0);
    il.Emit(OpCodes.Ret);
}
record Shape(string Name, int Parent, int Child);
