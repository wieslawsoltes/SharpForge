using System.Reflection;
using System.Reflection.Emit;
using System.Runtime.InteropServices;
using System.Text.Json;

var builder = new PersistedAssemblyBuilder(new AssemblyName("ModifiedOverrides"), typeof(object).Assembly);
var module = builder.DefineDynamicModule("ModifiedOverrides");
var first = module.DefineType("Fixture.First", TypeAttributes.Public);
var second = module.DefineType("Fixture.Second", TypeAttributes.Public);
first.CreateType();
second.CreateType();
var root = module.DefineType("Fixture.Root", TypeAttributes.Public | TypeAttributes.Abstract, typeof(object));
var child = module.DefineType("Fixture.Child", TypeAttributes.Public | TypeAttributes.Abstract, root);
Type[] none = [];
var cases = new[] {
    new Shape("Required", [first], none, none, none, typeof(int)),
    new Shape("Optional", none, [first], none, none, typeof(int)),
    new Shape("ReturnRequired", none, none, [first], none, typeof(int)),
    new Shape("ReturnOptional", none, none, none, [first], typeof(int)),
    new Shape("RequiredOrder", [first, second], none, none, none, typeof(int)),
    new Shape("OptionalOrder", none, [first, second], none, none, typeof(int)),
    new Shape("Mixed", [first], [second], [second], [first], typeof(int)),
    new Shape("ByRef", [first], none, none, none, typeof(int).MakeByRefType()),
    new Shape("Vector", none, [first], none, none, typeof(int[])),
    new Shape("Array", [first], [second], none, none, typeof(int[,]))
};
foreach (var shape in cases)
{
    Define(root, shape, true);
    Define(child, shape, false);
}
root.CreateType();
child.CreateType();
var observedTypes = new List<string> { "Fixture.Child" };
var required = new Shape("", [first], none, none, none, typeof(int));
var optional = required with { Required = none, Optional = [first] };
observedTypes.Add(Mismatch(module, "Kind", required, optional));
observedTypes.Add(Mismatch(module, "Identity", required, required with { Required = [second] }));
observedTypes.Add(Mismatch(module, "Order", optional with { Optional = [first, second] }, optional with { Optional = [second, first] }));
observedTypes.Add(Mismatch(module, "Omission", optional, optional with { Optional = none }));
observedTypes.Add(Mismatch(module, "Placement", required with { Required = none, ReturnRequired = [first] }, required));
using var stream = new MemoryStream();
builder.Save(stream);
var bytes = stream.ToArray();
var assembly = Assembly.Load(bytes);
const BindingFlags flags = BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Public;
var records = new List<object>();
foreach (var typeName in observedTypes)
{
    try
    {
        foreach (var method in assembly.GetType(typeName, true)!.GetMethods(flags).OrderBy(method => method.MetadataToken))
            records.Add(new { token = method.MetadataToken, name = method.Name,
                declaringType = method.DeclaringType!.FullName, baseToken = method.GetBaseDefinition().MetadataToken,
                baseType = method.GetBaseDefinition().DeclaringType!.FullName });
    }
    catch (TypeLoadException error)
    {
        records.Add(new { declaringType = typeName, error = error.GetType().Name });
    }
}
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription,
    image = Convert.ToBase64String(bytes), records }));

static void Define(TypeBuilder owner, Shape shape, bool newSlot)
{
    var flags = MethodAttributes.Public | MethodAttributes.Virtual | MethodAttributes.HideBySig | MethodAttributes.Abstract;
    if (newSlot) flags |= MethodAttributes.NewSlot;
    owner.DefineMethod(shape.Name, flags, CallingConventions.Standard | CallingConventions.HasThis,
        typeof(int), shape.ReturnRequired, shape.ReturnOptional, [shape.Parameter], [shape.Required], [shape.Optional]);
}
static string Mismatch(ModuleBuilder module, string name, Shape baseline, Shape different)
{
    const TypeAttributes attributes = TypeAttributes.Public | TypeAttributes.Abstract;
    var root = module.DefineType($"Fixture.{name}Root", attributes, typeof(object));
    var middle = module.DefineType($"Fixture.{name}Middle", attributes, root);
    var child = module.DefineType($"Fixture.{name}Child", attributes, middle);
    Define(root, baseline with { Name = name }, true);
    Define(middle, different with { Name = name }, true);
    Define(child, baseline with { Name = name }, false);
    root.CreateType();
    middle.CreateType();
    child.CreateType();
    return $"Fixture.{name}Child";
}
record Shape(string Name, Type[] Required, Type[] Optional, Type[] ReturnRequired, Type[] ReturnOptional, Type Parameter);
