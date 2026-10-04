using System;
using System.Linq;
using System.Reflection;

public static class InspectEmbedded
{
    public static void Main(string[] args)
    {
        var assembly = Assembly.LoadFrom(args[0]);
        string[] names = {
            "Microsoft.CodeAnalysis.EmbeddedAttribute",
            "System.Runtime.CompilerServices.NullableAttribute",
            "System.Runtime.CompilerServices.NullableContextAttribute"
        };
        foreach (var name in names)
        {
            var type = assembly.GetType(name, true);
            Console.WriteLine(name + ":" + type.IsNotPublic + ":" + type.IsSealed + ":" + type.BaseType.FullName);
            foreach (var field in type.GetFields(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
                Console.WriteLine(field.Name + ":" + field.FieldType.FullName + ":readonly=" + field.IsInitOnly);
            foreach (var attribute in type.GetCustomAttributes(false).OrderBy(value => value.GetType().FullName))
            {
                Console.Write(attribute.GetType().FullName);
                if (attribute is AttributeUsageAttribute usage)
                    Console.Write(":" + (int)usage.ValidOn + ":" + usage.AllowMultiple + ":" + usage.Inherited);
                Console.WriteLine();
            }
        }
        var nullable = assembly.GetType(names[1], true);
        var flags = nullable.GetField("NullableFlags");
        var scalar = nullable.GetConstructor(new[] { typeof(byte) });
        var vector = nullable.GetConstructor(new[] { typeof(byte[]) });
        Console.WriteLine("scalar=" + string.Join(",", (byte[])flags.GetValue(scalar.Invoke(new object[] { (byte)2 }))));
        var input = new byte[] { 1, 2, 0 };
        var array = (byte[])flags.GetValue(vector.Invoke(new object[] { input }));
        Console.WriteLine("array=" + string.Join(",", array) + ":same=" + ReferenceEquals(array, input));
        Console.WriteLine("null=" + (flags.GetValue(vector.Invoke(new object[] { null })) == null));
        var context = assembly.GetType(names[2], true);
        Console.WriteLine("context=" + context.GetField("Flag").GetValue(context.GetConstructor(new[] { typeof(byte) }).Invoke(new object[] { (byte)2 })));
    }
}
