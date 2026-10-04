using System.Runtime.InteropServices;
using System.Text.Json;

var types = new Dictionary<string, Type> {
    ["object"] = typeof(object), ["ValueType"] = typeof(ValueType), ["Array"] = typeof(Array),
    ["root"] = typeof(Fixture.IRoot), ["childInterface"] = typeof(Fixture.IChild),
    ["base"] = typeof(Fixture.Base), ["child"] = typeof(Fixture.Child), ["unrelated"] = typeof(Fixture.Unrelated),
    ["pair"] = typeof(Fixture.Pair), ["int"] = typeof(int), ["uint"] = typeof(uint),
    ["object[]"] = typeof(object[]), ["string[]"] = typeof(string[]), ["int[]"] = typeof(int[]), ["uint[]"] = typeof(uint[]),
    ["long[]"] = typeof(long[]), ["byte[]"] = typeof(byte[]), ["sbyte[]"] = typeof(sbyte[]), ["bool[]"] = typeof(bool[]),
    ["char[]"] = typeof(char[]), ["ushort[]"] = typeof(ushort[]), ["enum[]"] = typeof(Fixture.Code[]),
    ["base[]"] = typeof(Fixture.Base[]), ["child[]"] = typeof(Fixture.Child[]),
    ["int[*]"] = typeof(int).MakeArrayType(1), ["base[,]"] = typeof(Fixture.Base[,]), ["child[,]"] = typeof(Fixture.Child[,]),
    ["child[,,]"] = typeof(Fixture.Child[,,]), ["IList<int>"] = typeof(IList<int>), ["IList<uint>"] = typeof(IList<uint>),
    ["IList<object>"] = typeof(IList<object>), ["IReadOnlyList<object>"] = typeof(IReadOnlyList<object>),
};
string[][] pairs = [
    ["base", "child"], ["child", "base"], ["root", "child"], ["root", "childInterface"], ["childInterface", "root"],
    ["root", "unrelated"], ["object", "root"], ["object", "pair"], ["ValueType", "pair"], ["uint", "int"],
    ["Array", "int[]"], ["object[]", "string[]"], ["object[]", "int[]"], ["base[]", "child[]"], ["child[]", "base[]"],
    ["int[*]", "int[]"], ["int[]", "int[*]"], ["base[,]", "child[,]"], ["base[,]", "child[,,]"],
    ["uint[]", "int[]"], ["int[]", "uint[]"], ["long[]", "int[]"], ["byte[]", "sbyte[]"], ["byte[]", "bool[]"],
    ["ushort[]", "char[]"], ["ushort[]", "enum[]"], ["enum[]", "ushort[]"],
    ["IList<int>", "int[]"], ["IList<uint>", "int[]"], ["IList<object>", "string[]"],
    ["IReadOnlyList<object>", "string[]"], ["IList<object>", "int[]"], ["IList<int>", "int[*]"],
];
Console.WriteLine(JsonSerializer.Serialize(new {
    runtime = RuntimeInformation.FrameworkDescription,
    pairs = pairs.Select(pair => new { target = pair[0], source = pair[1], result = types[pair[0]].IsAssignableFrom(types[pair[1]]) }),
}));

namespace Fixture
{
    public interface IRoot { }
    public interface IChild : IRoot { }
    public class Base : IRoot { }
    public class Child : Base, IChild { }
    public class Unrelated { }
    public struct Pair { public int X; }
    public enum Code : ushort { Zero }
}
