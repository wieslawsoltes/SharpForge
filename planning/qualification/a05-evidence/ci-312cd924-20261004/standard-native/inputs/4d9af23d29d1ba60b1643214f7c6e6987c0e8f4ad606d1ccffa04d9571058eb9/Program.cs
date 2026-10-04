using System;
namespace CastFixtures {
 public interface IRoot {} public interface IChild : IRoot {}
 public class Base : IRoot {} public class Derived : Base, IChild {} public class Other {}
 public enum Color : int { A } public enum OtherColor : int { A } public enum ByteColor : byte { A }
 public interface ICov<out T> {} public interface IContra<in T> {} public interface IInvariant<T> {}
 public class Box<T> {} public class Producer : ICov<string> {} public class Consumer : IContra<object> {}
}
namespace First { public class Widget {} } namespace Second { public class Widget {} }
static class Program { static void Main() {
 Console.WriteLine(typeof(object).IsAssignableFrom(typeof(string)));
 Console.WriteLine(typeof(string).IsAssignableFrom(typeof(object)));
 Console.WriteLine(typeof(object).IsAssignableFrom(typeof(int)));
 Console.WriteLine(typeof(CastFixtures.Base).IsAssignableFrom(typeof(CastFixtures.Derived)));
 Console.WriteLine(typeof(CastFixtures.Derived).IsAssignableFrom(typeof(CastFixtures.Base)));
 Console.WriteLine(typeof(CastFixtures.Derived).IsAssignableFrom(typeof(CastFixtures.Derived)));
 Console.WriteLine(typeof(CastFixtures.Other).IsAssignableFrom(typeof(CastFixtures.Derived)));
 Console.WriteLine(typeof(Second.Widget).IsAssignableFrom(typeof(First.Widget)));
 Console.WriteLine(typeof(object).IsAssignableFrom(typeof(First.Widget)));
 Console.WriteLine(typeof(CastFixtures.IRoot).IsAssignableFrom(typeof(CastFixtures.Base)));
 Console.WriteLine(typeof(CastFixtures.IChild).IsAssignableFrom(typeof(CastFixtures.Derived)));
 Console.WriteLine(typeof(CastFixtures.IRoot).IsAssignableFrom(typeof(CastFixtures.Derived)));
 Console.WriteLine(typeof(CastFixtures.IChild).IsAssignableFrom(typeof(CastFixtures.Base)));
 Console.WriteLine(typeof(CastFixtures.IRoot).IsAssignableFrom(typeof(CastFixtures.IChild)));
 Console.WriteLine(typeof(CastFixtures.IChild).IsAssignableFrom(typeof(CastFixtures.IRoot)));
 Console.WriteLine(typeof(object).IsAssignableFrom(typeof(CastFixtures.IRoot)));
 Console.WriteLine(typeof(CastFixtures.IRoot).IsAssignableFrom(typeof(CastFixtures.Other)));
 Console.WriteLine(typeof(System.IComparable).IsAssignableFrom(typeof(string)));
 Console.WriteLine(typeof(System.IComparable<int>).IsAssignableFrom(typeof(int)));
 Console.WriteLine(typeof(System.IComparable<long>).IsAssignableFrom(typeof(int)));
 Console.WriteLine(typeof(System.IFormattable).IsAssignableFrom(typeof(bool)));
 Console.WriteLine(typeof(System.IFormattable).IsAssignableFrom(typeof(char)));
 Console.WriteLine(typeof(object[]).IsAssignableFrom(typeof(string[])));
 Console.WriteLine(typeof(string[]).IsAssignableFrom(typeof(object[])));
 Console.WriteLine(typeof(object[]).IsAssignableFrom(typeof(int[])));
 Console.WriteLine(typeof(System.Array).IsAssignableFrom(typeof(int[])));
 Console.WriteLine(typeof(object).IsAssignableFrom(typeof(int[])));
 Console.WriteLine(typeof(object[,]).IsAssignableFrom(typeof(string[,])));
 Console.WriteLine(typeof(object[,]).IsAssignableFrom(typeof(string[])));
 Console.WriteLine(typeof(int[,,]).IsAssignableFrom(typeof(int[,])));
 Console.WriteLine(typeof(int[,]).IsAssignableFrom(typeof(int[,])));
 Console.WriteLine(typeof(int).MakeArrayType(1).IsAssignableFrom(typeof(int[])));
 Console.WriteLine(typeof(int[]).IsAssignableFrom(typeof(int).MakeArrayType(1)));
 Console.WriteLine(typeof(object[]).IsAssignableFrom(typeof(int[][])));
 Console.WriteLine(typeof(object[][]).IsAssignableFrom(typeof(int[][])));
 Console.WriteLine(typeof(object[][]).IsAssignableFrom(typeof(string[][])));
 Console.WriteLine(typeof(uint[]).IsAssignableFrom(typeof(int[])));
 Console.WriteLine(typeof(int[]).IsAssignableFrom(typeof(uint[])));
 Console.WriteLine(typeof(sbyte[]).IsAssignableFrom(typeof(byte[])));
 Console.WriteLine(typeof(byte[]).IsAssignableFrom(typeof(bool[])));
 Console.WriteLine(typeof(ushort[]).IsAssignableFrom(typeof(char[])));
 Console.WriteLine(typeof(int[]).IsAssignableFrom(typeof(float[])));
 Console.WriteLine(typeof(System.Collections.Generic.IEnumerable<object>).IsAssignableFrom(typeof(string[])));
 Console.WriteLine(typeof(System.Collections.Generic.IList<object>).IsAssignableFrom(typeof(string[])));
 Console.WriteLine(typeof(System.Collections.Generic.IList<uint>).IsAssignableFrom(typeof(int[])));
 Console.WriteLine(typeof(System.Collections.Generic.IEnumerable<object>).IsAssignableFrom(typeof(int[])));
 Console.WriteLine(typeof(System.Collections.Generic.IEnumerable<string>).IsAssignableFrom(typeof(string[,])));
 Console.WriteLine(typeof(System.Collections.IEnumerable).IsAssignableFrom(typeof(string[,])));
 Console.WriteLine(typeof(CastFixtures.ICov<object>).IsAssignableFrom(typeof(CastFixtures.ICov<string>)));
 Console.WriteLine(typeof(CastFixtures.ICov<string>).IsAssignableFrom(typeof(CastFixtures.ICov<object>)));
 Console.WriteLine(typeof(CastFixtures.ICov<object>).IsAssignableFrom(typeof(CastFixtures.ICov<int>)));
 Console.WriteLine(typeof(CastFixtures.IContra<string>).IsAssignableFrom(typeof(CastFixtures.IContra<object>)));
 Console.WriteLine(typeof(CastFixtures.IContra<object>).IsAssignableFrom(typeof(CastFixtures.IContra<string>)));
 Console.WriteLine(typeof(CastFixtures.IInvariant<object>).IsAssignableFrom(typeof(CastFixtures.IInvariant<string>)));
 Console.WriteLine(typeof(CastFixtures.ICov<object>).IsAssignableFrom(typeof(CastFixtures.Producer)));
 Console.WriteLine(typeof(CastFixtures.IContra<string>).IsAssignableFrom(typeof(CastFixtures.Consumer)));
 Console.WriteLine(typeof(System.Collections.Generic.IEnumerable<object>).IsAssignableFrom(typeof(System.Collections.Generic.List<string>)));
 Console.WriteLine(typeof(System.Collections.Generic.List<object>).IsAssignableFrom(typeof(System.Collections.Generic.List<string>)));
 Console.WriteLine(typeof(System.Collections.Generic.IEnumerable<object>).IsAssignableFrom(typeof(System.Collections.Generic.List<int>)));
 Console.WriteLine(typeof(System.Collections.Generic.IList<object>).IsAssignableFrom(typeof(System.Collections.Generic.IList<string>)));
 Console.WriteLine(typeof(System.Action<string>).IsAssignableFrom(typeof(System.Action<object>)));
 Console.WriteLine(typeof(System.Func<object>).IsAssignableFrom(typeof(System.Func<string>)));
 Console.WriteLine(typeof(System.Func<object>).IsAssignableFrom(typeof(System.Func<int>)));
 Console.WriteLine(typeof(System.Func<string, object>).IsAssignableFrom(typeof(System.Func<object, string>)));
 Console.WriteLine(typeof(System.Collections.Generic.List<>).IsAssignableFrom(typeof(System.Collections.Generic.List<string>)));
 Console.WriteLine(typeof(System.Collections.Generic.List<>).IsAssignableFrom(typeof(System.Collections.Generic.List<>)));
 Console.WriteLine(typeof(System.Nullable<int>).IsAssignableFrom(typeof(int)));
 Console.WriteLine(typeof(int).IsAssignableFrom(typeof(System.Nullable<int>)));
 Console.WriteLine(typeof(object).IsAssignableFrom(typeof(System.Nullable<int>)));
 Console.WriteLine(typeof(System.ValueType).IsAssignableFrom(typeof(System.Nullable<int>)));
 Console.WriteLine(typeof(System.Nullable<long>).IsAssignableFrom(typeof(System.Nullable<int>)));
 Console.WriteLine(typeof(System.IComparable).IsAssignableFrom(typeof(System.Nullable<int>)));
 Console.WriteLine(typeof(System.Enum).IsAssignableFrom(typeof(CastFixtures.Color)));
 Console.WriteLine(typeof(System.ValueType).IsAssignableFrom(typeof(CastFixtures.Color)));
 Console.WriteLine(typeof(object).IsAssignableFrom(typeof(CastFixtures.Color)));
 Console.WriteLine(typeof(int).IsAssignableFrom(typeof(CastFixtures.Color)));
 Console.WriteLine(typeof(CastFixtures.Color).IsAssignableFrom(typeof(int)));
 Console.WriteLine(typeof(CastFixtures.OtherColor).IsAssignableFrom(typeof(CastFixtures.Color)));
 Console.WriteLine(typeof(System.IComparable).IsAssignableFrom(typeof(CastFixtures.Color)));
 Console.WriteLine(typeof(System.Nullable<CastFixtures.Color>).IsAssignableFrom(typeof(CastFixtures.Color)));
 Console.WriteLine(typeof(System.Nullable<int>).IsAssignableFrom(typeof(CastFixtures.Color)));
 Console.WriteLine(typeof(System.Enum).IsAssignableFrom(typeof(System.Nullable<CastFixtures.Color>)));
 Console.WriteLine(typeof(int[]).IsAssignableFrom(typeof(CastFixtures.Color[])));
 Console.WriteLine(typeof(CastFixtures.Color[]).IsAssignableFrom(typeof(int[])));
 Console.WriteLine(typeof(CastFixtures.OtherColor[]).IsAssignableFrom(typeof(CastFixtures.Color[])));
 Console.WriteLine(typeof(byte[]).IsAssignableFrom(typeof(CastFixtures.ByteColor[])));
} }
