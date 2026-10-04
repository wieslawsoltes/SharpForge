using System;
using System.Collections.Generic;

namespace TokenFixture;

class Base {}
sealed class Derived : Base {}
enum Choice { A = 1 }

static class Program
{
    public static int Value;
    public static void Target() {}

    static void Main()
    {
        object value = new Derived();
        Console.WriteLine(typeof(Derived) == value.GetType());
        Console.WriteLine(typeof(Base) == value.GetType());
        Console.WriteLine(object.ReferenceEquals(typeof(Derived), value.GetType()));
        Console.WriteLine(value.GetType().Name);
        Console.WriteLine(value.GetType().FullName);
        Console.WriteLine(typeof(string) == "text".GetType());
        Console.WriteLine(typeof(int) == ((object)1).GetType());
        Console.WriteLine(typeof(Choice) == ((object)Choice.A).GetType());
        Console.WriteLine(typeof(List<int>) == typeof(List<int>));
        Console.WriteLine(typeof(List<int>) != typeof(List<string>));
        Console.WriteLine(typeof(List<>).Name);
        Console.WriteLine(typeof(List<>).IsGenericTypeDefinition);
        Console.WriteLine(typeof(List<int>).IsGenericTypeDefinition);
        Console.WriteLine(typeof(List<int>).IsGenericType);
        Console.WriteLine(Type.GetTypeFromHandle(typeof(Derived).TypeHandle) == typeof(Derived));
        Console.WriteLine(typeof(string[]).Name);
        Console.WriteLine(typeof(string[]).FullName);
#if TOKEN_MEMBER_ORACLE
        // C# exposes member handles through reflection, owned by A04. The default
        // differential fixture omits this oracle; independent IL tests exercise
        // ldtoken MethodDef/MemberRef/MethodSpec and FieldDef/MemberRef directly.
        Console.WriteLine(typeof(Program).GetMethod(nameof(Target))!.MethodHandle.Equals(typeof(Program).GetMethod(nameof(Target))!.MethodHandle));
        Console.WriteLine(typeof(Program).GetField(nameof(Value))!.FieldHandle.Equals(typeof(Program).GetField(nameof(Value))!.FieldHandle));
#endif
    }
}
