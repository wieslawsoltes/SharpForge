using System.Reflection;
using System.Reflection.Emit;
using System.Runtime.InteropServices;
using System.Text.Json;

const BindingFlags flags = BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Public;
var records = new[] { typeof(Fixture.Root), typeof(Fixture.Middle), typeof(Fixture.Leaf) }
    .SelectMany(type => type.GetMethods(flags)).OrderBy(method => method.MetadataToken)
    .Select(method => new { token = method.MetadataToken, name = method.Name,
        declaringType = method.DeclaringType!.FullName, baseToken = method.GetBaseDefinition().MetadataToken,
        baseType = method.GetBaseDefinition().DeclaringType!.FullName });
var constraintCases = new[] { Observe("weakened-class-new", 20, 4), Observe("constructor-from-struct", 24, 16),
    Observe("stronger-class", 0, 4) };
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, records, constraintCases }));

static object Observe(string name, int rootFlags, int childFlags)
{
    var builder = new PersistedAssemblyBuilder(new AssemblyName(name), typeof(object).Assembly);
    var module = builder.DefineDynamicModule(name);
    var root = module.DefineType("Fixture.Root", TypeAttributes.Public, typeof(object));
    Define(root, rootFlags, true);
    var child = module.DefineType("Fixture.Child", TypeAttributes.Public, root);
    Define(child, childFlags, false);
    root.CreateType();
    child.CreateType();
    using var stream = new MemoryStream();
    builder.Save(stream);
    var bytes = stream.ToArray();
    var image = Convert.ToBase64String(bytes);
    try
    {
        var assembly = Assembly.Load(bytes);
        var method = assembly.GetType("Fixture.Child", true)!.GetMethod("M")!;
        return new { name, image, accepted = true, baseType = method.GetBaseDefinition().DeclaringType!.FullName,
            error = (string?)null };
    }
    catch (TypeLoadException error)
    {
        return new { name, image, accepted = false, baseType = (string?)null, error = error.GetType().Name };
    }
}
static void Define(TypeBuilder type, int flags, bool newSlot)
{
    var attributes = MethodAttributes.Public | MethodAttributes.Virtual | MethodAttributes.HideBySig;
    if (newSlot) attributes |= MethodAttributes.NewSlot;
    var method = type.DefineMethod("M", attributes);
    var parameter = method.DefineGenericParameters("T")[0];
    parameter.SetGenericParameterAttributes((GenericParameterAttributes)flags);
    method.SetReturnType(parameter);
    method.SetParameters(parameter);
    var il = method.GetILGenerator();
    il.Emit(OpCodes.Ldarg_1);
    il.Emit(OpCodes.Ret);
}

namespace Fixture
{
    public interface IMarker { }
    public class Marker { }
    public class Root
    {
        public virtual T Reference<T>(T value) where T : class => value;
        public virtual T Construct<T>(T value) where T : new() => value;
        public virtual T Value<T>(T value) where T : struct => value;
        public virtual T Contract<T>(T value) where T : IMarker => value;
        public virtual T Named<T>(T value) where T : Marker => value;
    }
    public class Middle : Root
    {
        public override T Reference<T>(T value) => value;
        public override T Contract<T>(T value) => value;
    }
    public class Leaf : Middle
    {
        public override T Reference<T>(T value) => value;
        public override T Construct<T>(T value) => value;
        public override T Value<T>(T value) => value;
        public override T Contract<T>(T value) => value;
        public override T Named<T>(T value) => value;
    }
}
