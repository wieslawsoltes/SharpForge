/** Real tree shape and execution comparisons for lifted and user-defined operators (SF-A02-T07.5). */
import { cs, out, feature } from './kit.js';

const prelude = `
using System;
using System.Linq.Expressions;
class Walker : ExpressionVisitor
{
    public string Kinds = "";
    public override Expression Visit(Expression node)
    {
        if (node != null) Kinds += node.NodeType + " ";
        return base.Visit(node);
    }
}
static class Tree
{
    public static void Show(Expression expression)
    {
        var walker = new Walker();
        walker.Visit(expression);
        Console.WriteLine(expression);
        Console.WriteLine(walker.Kinds.Trim());
    }
}`;

export const fixtures = feature('expression-tree-operators', [
  out('nullable-operators-conversions-and-overflow', cs`${prelude}
    class Program
    {
        static void Main()
        {
            Expression<Func<int?, int?, int?>> add = (a, b) => a + b;
            Expression<Func<int?, int?>> negate = value => -value;
            Expression<Func<int?, int?, bool>> equal = (a, b) => a == b;
            Expression<Func<int?, int?, bool>> less = (a, b) => a < b;
            Expression<Func<bool?, bool?, bool?>> and = (a, b) => a & b;
            Expression<Func<int?, long?>> widen = value => value;
            Expression<Func<int, long?>> wrap = value => value;
            Expression<Func<int?, int?, int?>> overflow = (a, b) => checked(a + b);
            Expression<Func<int?, int?>> plus = value => +value;
            Expression<Func<int?, bool>> isNull = value => value == null;
            Expression<Func<int?, long>> coalesce = value => value ?? 9L;
            Expression<Func<long, int>> narrow = value => checked((int)value);
            Tree.Show(add); Tree.Show(negate); Tree.Show(equal); Tree.Show(less); Tree.Show(and);
            Tree.Show(widen); Tree.Show(wrap); Tree.Show(overflow); Tree.Show(plus); Tree.Show(isNull);
            Tree.Show(coalesce); Tree.Show(narrow);
            Console.WriteLine(add.Compile()(3, 4));
            Console.WriteLine(add.Compile()(3, null) == null);
            Console.WriteLine(negate.Compile()(null) == null);
            Console.WriteLine(equal.Compile()(null, null));
            Console.WriteLine(less.Compile()(null, 1));
            Console.WriteLine(and.Compile()(false, null));
            Console.WriteLine(widen.Compile()(null) == null);
            Console.WriteLine(wrap.Compile()(123));
            Console.WriteLine(overflow.Compile()(null, int.MaxValue) == null);
            try { overflow.Compile()(int.MaxValue, 1); }
            catch (OverflowException) { Console.WriteLine("add overflow"); }
            try { narrow.Compile()(long.MaxValue); }
            catch (OverflowException) { Console.WriteLine("conversion overflow"); }
            Console.WriteLine(coalesce.Compile()(null) + ":" + coalesce.Compile()(5));
        }
    }
  `),
  out('lifted-methods-checked-methods-and-conversion-lambda', cs`${prelude}
    struct Amount
    {
        public int Value;
        public Amount(int value) { Value = value; }
        public static Amount operator +(Amount a, Amount b) => new Amount(a.Value + b.Value);
        public static Amount operator checked +(Amount a, Amount b) => new Amount(a.Value + b.Value + 100);
        public static Amount operator -(Amount value) => new Amount(-value.Value);
        public static bool operator ==(Amount a, Amount b) => a.Value == b.Value;
        public static bool operator !=(Amount a, Amount b) => a.Value != b.Value;
        public static implicit operator int(Amount value) => value.Value;
        public override bool Equals(object value) => false;
        public override int GetHashCode() => Value;
    }
    class Gate
    {
        public int Value;
        public static int Calls;
        public Gate(int value) { Value = value; }
        public static Gate Next(Gate value) { Calls++; return value; }
        public static bool operator true(Gate value) => value.Value != 0;
        public static bool operator false(Gate value) => value.Value == 0;
        public static Gate operator &(Gate a, Gate b) => new Gate(a.Value & b.Value);
        public static Gate operator |(Gate a, Gate b) => new Gate(a.Value | b.Value);
    }
    class Program
    {
        static void Main()
        {
            Expression<Func<Amount?, Amount?, Amount?>> add = (a, b) => a + b;
            Expression<Func<Amount?, Amount, Amount?>> mixed = (a, b) => a + b;
            Expression<Func<Amount?, Amount?>> negate = value => -value;
            Expression<Func<Amount?, Amount?, bool>> equal = (a, b) => a == b;
            Expression<Func<Amount?, Amount?, Amount?>> checkedAdd = (a, b) => checked(a + b);
            Expression<Func<Amount?, long?>> convert = value => value;
            Expression<Func<Amount?, long>> coalesce = value => value ?? 23L;
            Expression<Func<Gate, Gate, Gate>> and = (a, b) => a && Gate.Next(b);
            Expression<Func<Gate, Gate, Gate>> or = (a, b) => a || Gate.Next(b);
            Tree.Show(add); Tree.Show(mixed); Tree.Show(negate); Tree.Show(equal); Tree.Show(checkedAdd);
            Tree.Show(convert); Tree.Show(coalesce); Tree.Show(and); Tree.Show(or);
            Console.WriteLine(add.Compile()(new Amount(3), new Amount(4)).Value.Value);
            Console.WriteLine(mixed.Compile()(null, new Amount(4)) == null);
            Console.WriteLine(negate.Compile()(new Amount(3)).Value.Value);
            Console.WriteLine(equal.Compile()(null, null));
            Console.WriteLine(equal.Compile()(null, new Amount(0)));
            Console.WriteLine(checkedAdd.Compile()(new Amount(3), new Amount(4)).Value.Value);
            Console.WriteLine(convert.Compile()(new Amount(6)));
            Console.WriteLine(convert.Compile()(null) == null);
            Console.WriteLine(coalesce.Compile()(new Amount(8)) + ":" + coalesce.Compile()(null));
            Gate.Calls = 0;
            Console.WriteLine(and.Compile()(new Gate(0), new Gate(1)).Value + ":" + Gate.Calls);
            Console.WriteLine(and.Compile()(new Gate(1), new Gate(1)).Value + ":" + Gate.Calls);
            Console.WriteLine(or.Compile()(new Gate(1), new Gate(0)).Value + ":" + Gate.Calls);
            Console.WriteLine(or.Compile()(new Gate(0), new Gate(1)).Value + ":" + Gate.Calls);
        }
    }
  `),
  out('enum-promotion-and-exact-conditional-types', cs`${prelude}
    enum Bits : byte { None = 0, One = 1, Two = 2 }
    class Program
    {
        static void Main()
        {
            Expression<Func<Bits, Bits>> bits = value => value | Bits.Two;
            Expression<Func<Bits, Bits, byte>> distance = (a, b) => a - b;
            Expression<Func<Bits?, Bits?>> complement = value => ~value;
            Expression<Func<Bits?, Bits?, bool>> equal = (a, b) => a == b;
            Expression<Func<bool, object>> conditional = flag => flag ? "yes" : (object)17;
            Expression<Func<double, double>> checkedReal = value => checked(-value * 2);
            Tree.Show(bits); Tree.Show(distance); Tree.Show(complement); Tree.Show(equal);
            Tree.Show(conditional); Tree.Show(checkedReal);
            Console.WriteLine((byte)bits.Compile()(Bits.One));
            Console.WriteLine(distance.Compile()(Bits.Two, Bits.One));
            Console.WriteLine((byte)complement.Compile()(Bits.One).Value);
            Console.WriteLine(complement.Compile()(null) == null);
            Console.WriteLine(equal.Compile()(null, null));
            Console.WriteLine(conditional.Compile()(true));
            Console.WriteLine(conditional.Compile()(false));
            Console.WriteLine(checkedReal.Compile()(1.5));
        }
    }
  `),
]);
