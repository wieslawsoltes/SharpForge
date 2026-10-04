using System.Reflection;
using System.Reflection.Emit;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Text.Json;

var shapes = new[] {
    new Shape("DirectPrivate", 1, 1),
    new Shape("WidenPrivate", 1, 6),
    new Shape("SkippedLexical", 1, 6),
    new Shape("PrivateChain", 1, 6),
    new Shape("InheritedPrivate", 1, 6),
    new Shape("SiblingIntermediate", 1, 6),
    new Shape("ExternalIntermediate", 1, 6),
    new Shape("OutsideChild", 1, 6),
    new Shape("NestedPublic", 6, 6),
    new Shape("NestedFamily", 4, 6),
    new Shape("NarrowPublic", 6, 4),
    new Shape("PrivateScope", 0, 6),
    new Shape("NewSlot", 1, 6)
};
var builder = new PersistedAssemblyBuilder(new AssemblyName("NestedStrictOverrides"), typeof(object).Assembly);
var module = builder.DefineDynamicModule("NestedStrictOverrides");
var queries = new List<(string Name, string Child)>();
foreach (var shape in shapes)
{
    var root = module.DefineType($"Fixture.{shape.Name}Root", TypeAttributes.Public, typeof(object));
    Define(root, shape.Parent, true, true);
    var types = new List<TypeBuilder> { root };
    TypeBuilder parent = root, enclosing = root;
    if (shape.Name == "SkippedLexical")
    {
        enclosing = root.DefineNestedType("Container", TypeAttributes.NestedPublic, typeof(object));
        types.Add(enclosing);
    }
    if (shape.Name is "PrivateChain" or "InheritedPrivate" or "SiblingIntermediate" or "ExternalIntermediate")
    {
        parent = shape.Name == "ExternalIntermediate"
            ? module.DefineType($"Fixture.{shape.Name}Middle", TypeAttributes.Public, root)
            : root.DefineNestedType("Middle", TypeAttributes.NestedPublic, root);
        types.Add(parent);
        if (shape.Name == "PrivateChain") Define(parent, 1, false, true);
        if (shape.Name is "PrivateChain" or "InheritedPrivate") enclosing = parent;
    }
    var child = shape.Name == "OutsideChild"
        ? module.DefineType($"Fixture.{shape.Name}Child", TypeAttributes.Public, parent)
        : enclosing.DefineNestedType("Child", TypeAttributes.NestedPublic, parent);
    Define(child, shape.Child, shape.Name == "NewSlot", false);
    types.Add(child);
    queries.Add((shape.Name, child.FullName!));
    foreach (var type in types) type.CreateType();
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
            tokens[FullName(handle)] = MetadataTokens.GetToken(method);
}
var assembly = Assembly.Load(bytes);
var records = new List<object>();
foreach (var query in queries)
{
    var token = tokens[query.Child];
    try
    {
        var type = assembly.GetType(query.Child, true)!;
        var method = type.GetMethod("M", BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)!;
        var root = method.GetBaseDefinition();
        records.Add(new { token, name = "M", scenario = query.Name, declaringType = query.Child,
            baseToken = root.MetadataToken, baseType = root.DeclaringType!.FullName });
    }
    catch (Exception error) when (error is TypeLoadException or MethodAccessException)
    {
        records.Add(new { token, name = "M", scenario = query.Name, declaringType = query.Child, error = error.GetType().Name });
    }
}
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription,
    image = Convert.ToBase64String(bytes), records }));

string FullName(TypeDefinitionHandle handle)
{
    var type = metadata.GetTypeDefinition(handle);
    var owner = type.GetDeclaringType();
    var name = metadata.GetString(type.Name);
    if (!owner.IsNil) return FullName(owner) + "+" + name;
    var space = metadata.GetString(type.Namespace);
    return space.Length == 0 ? name : space + "." + name;
}

static void Define(TypeBuilder owner, int access, bool newSlot, bool strict)
{
    var flags = (MethodAttributes)access | MethodAttributes.Virtual | MethodAttributes.HideBySig;
    if (newSlot) flags |= MethodAttributes.NewSlot;
    if (strict) flags |= MethodAttributes.CheckAccessOnOverride;
    var method = owner.DefineMethod("M", flags, CallingConventions.Standard | CallingConventions.HasThis, typeof(int), [typeof(int)]);
    var il = method.GetILGenerator();
    il.Emit(OpCodes.Ldc_I4_0);
    il.Emit(OpCodes.Ret);
}
record Shape(string Name, int Parent, int Child);
