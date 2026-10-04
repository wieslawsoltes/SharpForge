using System;
using System.Collections.Generic;
using System.Reflection;

[assembly: Tag("assembly")]
[module: Tag("module")]

[AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
public class TagAttribute : Attribute
{
    public string Name;
    public TagAttribute(string name) { Name = name; }
}

[AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
public class ShapeAttribute : Attribute
{
    public object Value;
    public ShapeAttribute(object value) { Value = value; }
}

[return: Tag("delegate-return")]
public delegate string Callback();

public class Outer<[Tag("outer-parameter")] T>
{
    public class Inner<[Tag("inner-parameter")] U> { }
    [field: Tag("property-field")]
    [property: Tag("property")]
    public string Name { get; set; }
    [field: Tag("event-field")]
    [method: Tag("event-method")]
    [event: Tag("event")]
    public event Action Changed;
    [return: Tag("method-return")]
    public string Method<[Tag("method-parameter")] V>() { return ""; }
    public int Number
    {
        [return: Tag("getter-return")] get { return 1; }
        [param: Tag("setter-value")] set { }
    }
}

[Shape(typeof(Dictionary<string, Outer<int>.Inner<long>[]>))]
[Shape(typeof(Dictionary<,>))]
[Shape(new int[] { 2, 5 })]
public class Shapes { }

public static class Program
{
    private static void Dump(object[] attributes)
    {
        foreach (object attribute in attributes)
            if (attribute is TagAttribute) Console.WriteLine(((TagAttribute)attribute).Name);
    }

    private static void DumpType(Type type)
    {
        if (type.IsArray)
        {
            DumpType(type.GetElementType());
            Console.Write("[" + type.GetArrayRank() + "]");
        }
        else if (type.IsGenericParameter) Console.Write("!" + type.GenericParameterPosition);
        else if (type.IsGenericType)
        {
            Console.Write(type.GetGenericTypeDefinition().FullName + "[");
            foreach (Type argument in type.GetGenericArguments()) { DumpType(argument); Console.Write(";"); }
            Console.Write("]");
        }
        else Console.Write(type.FullName);
    }

    public static void Main()
    {
        Type type = typeof(Outer<>);
        Dump(type.Assembly.GetCustomAttributes(false));
        Dump(type.Module.GetCustomAttributes(false));
        Dump(type.GetGenericArguments()[0].GetCustomAttributes(false));
        foreach (Type parameter in type.GetNestedType("Inner`1").GetGenericArguments())
            Dump(parameter.GetCustomAttributes(false));
        BindingFlags fields = BindingFlags.Instance | BindingFlags.NonPublic;
        Dump(type.GetField("<Name>k__BackingField", fields).GetCustomAttributes(false));
        Dump(type.GetProperty("Name").GetCustomAttributes(false));
        Dump(type.GetField("Changed", fields).GetCustomAttributes(false));
        Dump(type.GetEvent("Changed").GetCustomAttributes(false));
        Dump(type.GetMethod("add_Changed").GetCustomAttributes(false));
        Dump(type.GetMethod("remove_Changed").GetCustomAttributes(false));
        Dump(type.GetMethod("Method").ReturnParameter.GetCustomAttributes(false));
        Dump(type.GetMethod("Method").GetGenericArguments()[0].GetCustomAttributes(false));
        Dump(type.GetMethod("get_Number").ReturnParameter.GetCustomAttributes(false));
        Dump(type.GetMethod("set_Number").GetParameters()[0].GetCustomAttributes(false));
        Dump(typeof(Callback).GetMethod("Invoke").ReturnParameter.GetCustomAttributes(false));
        Dump(typeof(Callback).GetMethod("EndInvoke").ReturnParameter.GetCustomAttributes(false));
        foreach (object attribute in typeof(Shapes).GetCustomAttributes(typeof(ShapeAttribute), false))
        {
            object value = ((ShapeAttribute)attribute).Value;
            if (value is Type) DumpType((Type)value);
            else foreach (int element in (int[])value) Console.Write(element + ";");
            Console.WriteLine();
        }
    }
}
