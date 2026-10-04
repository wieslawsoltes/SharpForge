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
using var stream = new MemoryStream();
builder.Save(stream);
var bytes = stream.ToArray();
var assembly = Assembly.Load(bytes);
const BindingFlags flags = BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Public;
var records = assembly.GetType("Fixture.Child", true)!.GetMethods(flags).OrderBy(method => method.MetadataToken)
    .Select(method => new { token = method.MetadataToken, name = method.Name,
        declaringType = method.DeclaringType!.FullName, baseToken = method.GetBaseDefinition().MetadataToken,
        baseType = method.GetBaseDefinition().DeclaringType!.FullName });
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription,
    image = Convert.ToBase64String(bytes), records }));

static void Define(TypeBuilder owner, Shape shape, bool newSlot)
{
    var flags = MethodAttributes.Public | MethodAttributes.Virtual | MethodAttributes.HideBySig | MethodAttributes.Abstract;
    if (newSlot) flags |= MethodAttributes.NewSlot;
    owner.DefineMethod(shape.Name, flags, CallingConventions.Standard | CallingConventions.HasThis,
        typeof(int), shape.ReturnRequired, shape.ReturnOptional, [shape.Parameter], [shape.Required], [shape.Optional]);
}
record Shape(string Name, Type[] Required, Type[] Optional, Type[] ReturnRequired, Type[] ReturnOptional, Type Parameter);
