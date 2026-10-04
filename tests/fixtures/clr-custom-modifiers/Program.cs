using System.Reflection;
using System.Reflection.Emit;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text.Json;

var builder = new PersistedAssemblyBuilder(new AssemblyName("ModifierFixture"), typeof(object).Assembly);
var module = builder.DefineDynamicModule("ModifierFixture");
var modifiers = new[] { "ModifierA", "ModifierB", "ModifierC", "ModifierD" }
    .Select(name => module.DefineType(name, TypeAttributes.Public).CreateType()!).ToArray();
var type = module.DefineType("Members", TypeAttributes.Public);
var required = new[] { modifiers[0], modifiers[1] };
var optional = new[] { modifiers[2], modifiers[3] };
type.DefineField("Many", typeof(int), required, optional, FieldAttributes.Public);
type.DefineField("Plain", typeof(int), FieldAttributes.Public);
type.DefineField("Volatile", typeof(int), new[] { typeof(IsVolatile) }, null, FieldAttributes.Public);
var getter = type.DefineMethod("get_Item", MethodAttributes.Public | MethodAttributes.SpecialName | MethodAttributes.HideBySig,
    CallingConventions.HasThis, typeof(int), required, optional, new[] { typeof(int) },
    new[] { new[] { modifiers[0] } }, new[] { new[] { modifiers[3] } });
getter.DefineParameter(1, ParameterAttributes.None, "index");
getter.GetILGenerator().Emit(OpCodes.Ldc_I4_0);
getter.GetILGenerator().Emit(OpCodes.Ret);
var property = type.DefineProperty("Item", PropertyAttributes.None, CallingConventions.HasThis,
    typeof(int), required, optional, new[] { typeof(int) },
    new[] { new[] { modifiers[1] } }, new[] { new[] { modifiers[2], modifiers[3] } });
property.SetGetMethod(getter);
var method = type.DefineMethod("Use", MethodAttributes.Public | MethodAttributes.Static, CallingConventions.Standard,
    typeof(int), required, optional, new[] { typeof(int).MakeByRefType() }, new[] { required }, new[] { optional });
method.DefineParameter(1, ParameterAttributes.None, "value");
method.GetILGenerator().Emit(OpCodes.Ldc_I4_0);
method.GetILGenerator().Emit(OpCodes.Ret);
type.CreateType();
using var output = new MemoryStream();
builder.Save(output);
var image = output.ToArray();
File.WriteAllBytes(args[0], image);
var loaded = Assembly.Load(image).GetType("Members")!;
using var pe = new PEReader(new MemoryStream(image));
var metadata = pe.GetMetadataReader();
var modifierNames = new Dictionary<int, string>();
foreach (var handle in metadata.TypeDefinitions)
{
    var definition = metadata.GetTypeDefinition(handle);
    var space = metadata.GetString(definition.Namespace);
    modifierNames[MetadataTokens.GetToken(handle)] = (space.Length == 0 ? "" : space + ".") + metadata.GetString(definition.Name);
}
foreach (var handle in metadata.TypeReferences)
{
    var definition = metadata.GetTypeReference(handle);
    var space = metadata.GetString(definition.Namespace);
    modifierNames[MetadataTokens.GetToken(handle)] = (space.Length == 0 ? "" : space + ".") + metadata.GetString(definition.Name);
}
string?[] Names(Type[] values) => values.Select(value => value.FullName).ToArray();
var records = new List<object>();
foreach (var field in loaded.GetFields(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
    records.Add(new { kind = "field", token = field.MetadataToken, position = -1,
        required = Names(field.GetRequiredCustomModifiers()), optional = Names(field.GetOptionalCustomModifiers()) });
foreach (var member in loaded.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly))
    foreach (var parameter in new[] { member.ReturnParameter }.Concat(member.GetParameters()))
        records.Add(new { kind = "parameter", token = member.MetadataToken, position = parameter.Position,
            required = Names(parameter.GetRequiredCustomModifiers()), optional = Names(parameter.GetOptionalCustomModifiers()) });
foreach (var member in loaded.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
{
    records.Add(new { kind = "property", token = member.MetadataToken, position = -1,
        required = Names(member.GetRequiredCustomModifiers()), optional = Names(member.GetOptionalCustomModifiers()) });
    foreach (var parameter in member.GetIndexParameters())
        records.Add(new { kind = "indexParameter", token = member.MetadataToken, position = parameter.Position,
            required = Names(parameter.GetRequiredCustomModifiers()), optional = Names(parameter.GetOptionalCustomModifiers()) });
}
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, modifierNames, records }));
