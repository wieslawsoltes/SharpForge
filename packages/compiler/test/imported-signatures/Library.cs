// The library the tests of imported signatures bind against. Roslyn builds it (verify-dotnet.mjs --update writes
// Library.dll); the signatures below carry custom modifiers that a source override or implementation must repeat:
//   in parameter of a virtual member        modreq(InAttribute) before BYREF
//   ref readonly return                     modreq(InAttribute) before BYREF
//   init accessor                           modreq(IsExternalInit) on the return type
using System;

namespace Imported
{
    public abstract class Shape
    {
        public abstract int Area(in int scale);
        public abstract ref readonly int Corner { get; }
        public abstract int Size { get; init; }
        public virtual string Describe(in long first, ref int second, out int third) { third = second; return "Shape:" + first; }
        public string Report(int scale)
        {
            int second = 2;
            return Area(in scale) + " " + Corner + " " + Size + " " + Describe(7L, ref second, out var third) + " " + third;
        }
    }

    public interface IMeasure
    {
        int Measure(in int unit);
        ref readonly int Origin { get; }
        int Tag { get; init; }
    }

    public static class Measures
    {
        public static string Report(IMeasure measure)
        {
            int unit = 3;
            return measure.Measure(in unit) + " " + measure.Origin + " " + measure.Tag;
        }
    }

    public abstract class Source<T>
    {
        public abstract T Pick(in T first, in T second);
        public T First(T first, T second) { return Pick(in first, in second); }
    }
}
