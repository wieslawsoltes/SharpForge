#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;

static class InspectNullability
{
    static string Shape(NullabilityInfo info)
    {
        string result = info.ReadState + "/" + info.WriteState;
        if (info.ElementType is not null) result += "[" + Shape(info.ElementType) + "]";
        if (info.GenericTypeArguments.Length != 0) result += "<" + string.Join(",", info.GenericTypeArguments.Select(Shape)) + ">";
        return result;
    }

    static void Main(string[] args)
    {
        Assembly assembly = Assembly.LoadFile(Path.GetFullPath(args[0]));
        var context = new NullabilityInfoContext();
        var lines = new List<string>();
        const BindingFlags flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;
        foreach (Type type in assembly.GetTypes().Where(t => t.Namespace == "NullableMetadata"))
        {
            string owner = type.FullName!;
            foreach (FieldInfo field in type.GetFields(flags).Where(f => f.IsPublic || f.IsFamily || f.IsFamilyOrAssembly))
                lines.Add(owner + "::field:" + field.Name + "=" + Shape(context.Create(field)));
            foreach (PropertyInfo property in type.GetProperties(flags))
                lines.Add(owner + "::property:" + property.Name + "=" + Shape(context.Create(property)));
            foreach (EventInfo item in type.GetEvents(flags))
                lines.Add(owner + "::event:" + item.Name + "=" + Shape(context.Create(item)));
            foreach (MethodBase method in type.GetMethods(flags).Cast<MethodBase>().Concat(type.GetConstructors(flags))
                .Where(m => m.IsPublic || m.IsFamily || m.IsFamilyOrAssembly))
            {
                ParameterInfo[] parameters = method.GetParameters();
                string key = owner + "::" + method.Name + "(" + string.Join(",", parameters.Select(p => p.ParameterType.ToString())) + ")";
                if (method is MethodInfo info) lines.Add(key + ":return=" + Shape(context.Create(info.ReturnParameter)));
                for (int index = 0; index < parameters.Length; index++)
                    lines.Add(key + ":parameter:" + index + "=" + Shape(context.Create(parameters[index])));
            }
        }
        foreach (string line in lines.OrderBy(value => value, StringComparer.Ordinal)) Console.WriteLine(line);
    }
}
