using System;
using System.Linq;
using System.Reflection;

// Loads an assembly with the real runtime (types are loaded, so layout, interface implementation and overrides are
// checked by the CLR) and prints its declarations in a stable text form.
static class Program
{
    const BindingFlags All = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;

    static string Name(Type t) => t.IsGenericParameter ? "!" + t.Name : t.ToString();

    static int Main(string[] args)
    {
        var assembly = Assembly.LoadFile(args[0]);
        Console.WriteLine("assembly " + assembly.GetName().Name);
        foreach (var a in assembly.GetCustomAttributesData()) Console.WriteLine("  [assembly: " + a + "]");
        foreach (var type in assembly.GetTypes().OrderBy(t => t.FullName))
        {
            Console.WriteLine("type " + type.FullName + " : " + (type.BaseType == null ? "-" : Name(type.BaseType)) + " attrs=" + type.Attributes);
            foreach (var a in type.GetCustomAttributesData()) Console.WriteLine("  [" + a + "]");
            foreach (var i in type.GetInterfaces().OrderBy(i => i.ToString())) Console.WriteLine("  implements " + i);
            foreach (var p in type.GetGenericArguments())
                if (p.IsGenericParameter) Console.WriteLine("  typeparam " + p.Name + " " + p.GenericParameterAttributes + " : " + string.Join(", ", p.GetGenericParameterConstraints().Select(Name)));
            foreach (var f in type.GetFields(All).OrderBy(f => f.Name))
            {
                Console.WriteLine("  field " + Name(f.FieldType) + " " + f.Name + " attrs=" + f.Attributes + (f.IsLiteral ? " = " + (f.GetRawConstantValue() ?? "null") : ""));
                foreach (var a in f.GetCustomAttributesData()) Console.WriteLine("    [" + a + "]");
            }
            foreach (var m in type.GetMethods(All).Cast<MethodBase>().Concat(type.GetConstructors(All)).OrderBy(m => m.ToString()))
            {
                var ret = m is MethodInfo mi ? Name(mi.ReturnType) + " " : "";
                Console.WriteLine("  method " + ret + m.Name + (m.IsGenericMethodDefinition ? "<" + string.Join(",", m.GetGenericArguments().Select(g => g.Name + ":" + g.GenericParameterAttributes + ":" + string.Join("&", g.GetGenericParameterConstraints().Select(Name)))) + ">" : "")
                    + "(" + string.Join(", ", m.GetParameters().Select(p => (p.IsOut ? "out " : "") + (p.IsIn ? "in " : "") + Name(p.ParameterType) + " " + p.Name)) + ") attrs=" + m.Attributes + " impl=" + m.MethodImplementationFlags);
                foreach (var a in m.GetCustomAttributesData()) Console.WriteLine("    [" + a + "]");
                foreach (var p in m.GetParameters()) foreach (var a in p.GetCustomAttributesData()) Console.WriteLine("    param " + p.Name + " [" + a + "]");
            }
            foreach (var p in type.GetProperties(All).OrderBy(p => p.Name))
            {
                Console.WriteLine("  property " + Name(p.PropertyType) + " " + p.Name + "[" + string.Join(", ", p.GetIndexParameters().Select(x => Name(x.ParameterType))) + "] get=" + p.GetMethod?.Name + " set=" + p.SetMethod?.Name);
                foreach (var a in p.GetCustomAttributesData()) Console.WriteLine("    [" + a + "]");
            }
            foreach (var e in type.GetEvents(All).OrderBy(e => e.Name)) Console.WriteLine("  event " + e.EventHandlerType + " " + e.Name + " add=" + e.AddMethod?.Name + " remove=" + e.RemoveMethod?.Name);
            if (type.IsInterface || type.IsAbstract || type.IsGenericTypeDefinition || type.IsEnum || typeof(Delegate).IsAssignableFrom(type)) continue;
            foreach (var i in type.GetInterfaces())
            {
                var map = type.GetInterfaceMap(i);
                for (int k = 0; k < map.InterfaceMethods.Length; k++) Console.WriteLine("  map " + i + "." + map.InterfaceMethods[k].Name + " -> " + map.TargetMethods[k].DeclaringType + "." + map.TargetMethods[k].Name);
            }
        }
        return 0;
    }
}
