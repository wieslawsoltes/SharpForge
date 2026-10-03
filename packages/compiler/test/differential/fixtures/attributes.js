/**
 * Differential fixtures for SF-A02-T41 (C# 1 attributes): class lookup with the `Attribute` suffix, constructor and
 * named arguments, attribute locations, AttributeUsage targets and multiplicity, and uses of obsolete symbols.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('attributes', [
    out(
      'framework-attributes-do-not-change-execution',
      cs`
    using System;
    using System.Diagnostics;
    [assembly: CLSCompliant(false)]
    [Flags]
    enum Colors { None = 0, Red = 1, Green = 2, Blue = 4 }
    [Serializable]
    class Counter
    {
        [NonSerialized]
        int hits;
        [Obsolete("use Hits")]
        public int OldHits { get { return hits; } }
        public int Hits { get { return hits; } }
        [Obsolete]
        public void Bump() { hits++; }
        [Obsolete("old helper")]
        public void BumpTwice() { Bump(); Bump(); }
        [DebuggerStepThrough]
        public void Add(int amount) { hits += amount; }
    }
    [Obsolete("old type")]
    class Legacy
    {
        public static int Value = 3;
        public static Legacy Make() { return new Legacy(); }
    }
    class Program
    {
        [STAThread]
        static void Main()
        {
            Counter c = new Counter();
            c.Add(2);
            c.Bump();
            c.BumpTwice();
            Console.WriteLine(c.OldHits + c.Hits);
            Console.WriteLine(Legacy.Value);
            Legacy l = Legacy.Make();
            Colors both = Colors.Red | Colors.Blue;
            Console.WriteLine((int)both);
            Console.WriteLine(both == (Colors.Red | Colors.Blue));
        }
    }
    `,
    ),
    diag(
      'class-lookup-usage-and-constructor',
      cs`
    using System;
    [AttributeUsage(AttributeTargets.Method, AllowMultiple = false)]
    class MarkAttribute : Attribute
    {
        public MarkAttribute(int level) { Level = level; }
        public int Level;
        public string Name { get; set; }
    }
    [AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true)]
    class TagAttribute : Attribute
    {
        public TagAttribute(string text) { }
    }
    [AttributeUsage(AttributeTargets.Class)]
    class NotAnAttribute { }
    abstract class BaseAttribute : Attribute { }
    class Y : Attribute { }
    class YAttribute : Attribute { }
    [Tag("a"), Tag("b")]
    [Base]
    [Y]
    [@Y]
    class Program
    {
        [Mark(1, Name = "x")]
        static void Marked() { }
        [Mark(1)]
        int field;
        [Mark(1), Mark(2)]
        static void Twice() { }
        [Mark(1)]
        [MarkAttribute(2)]
        static void TwiceInTwoLists() { }
        [Mark("s")]
        static void WrongArgument() { }
        [Mark]
        static void MissingArgument() { }
        [Mark(1, Missing = 2)]
        static void WrongNamed() { }
        [Nope]
        static void Unknown() { }
        [Program]
        static void NotAttribute() { }
        static void Main() { }
    }
    `,
    ),
    diag(
      'named-arguments-and-constant-arguments',
      cs`
    using System;
    [AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
    class NoteAttribute : Attribute
    {
        public NoteAttribute() { }
        public NoteAttribute(string text) { }
        public NoteAttribute(Type type) { }
        public NoteAttribute(int[] values) { }
        public readonly int Fixed;
        public static int Shared;
        public int Level;
        public int ReadOnly { get { return 0; } }
        public string Text { get; set; }
        int hidden;
    }
    class Program
    {
        static int number = 2;
        const int Constant = 4;
        [Note(Fixed = 1)]
        [Note(Shared = 1)]
        [Note(ReadOnly = 1)]
        [Note(hidden = 1)]
        [Note(Level = 1, Level = 2)]
        [Note(Level = "text")]
        [Note(Text = "ok", Level = Constant)]
        [Note(typeof(Program))]
        [Note(new int[] { 1, 2 })]
        static void Named() { }
        [Note(number.ToString())]
        [Note(Level = number)]
        static void NotConstant() { }
        static void Main() { Console.WriteLine(number); }
    }
    `,
    ),
    diag(
      'attribute-locations',
      cs`
    using System;
    [AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
    class NoteAttribute : Attribute { }
    [AttributeUsage(AttributeTargets.ReturnValue | AttributeTargets.Parameter)]
    class OnlyReturnAttribute : Attribute { }
    [AttributeUsage(AttributeTargets.Field)]
    class OnlyFieldAttribute : Attribute { }
    [AttributeUsage(AttributeTargets.Assembly)]
    class OnlyAssemblyAttribute : Attribute { }
    [type: Note]
    [OnlyAssembly]
    class Program
    {
        [return: OnlyReturn]
        [OnlyReturn]
        [method: Note]
        [field: Note]
        [bogus: Note]
        static int Targets([OnlyReturn] int a, [OnlyField] int b) { return a + b; }
        [field: OnlyField]
        [OnlyField]
        public int Auto { get; set; }
        [property: OnlyField]
        public int Computed { [return: OnlyReturn] get { return 1; } [param: OnlyReturn] [OnlyReturn] set { } }
        [type: Note]
        [assembly: Note]
        [OnlyField]
        int field;
        static void Main() { }
    }
    enum Level
    {
        [OnlyField] Low,
        [OnlyReturn] High,
    }
    `,
    ),
    diag(
      'obsolete-uses',
      cs`
    using System;
    [Obsolete("old type")]
    class Legacy
    {
        public int Value;
        public static void Run() { }
    }
    class Modern
    {
        [Obsolete("old constructor")]
        public Modern() { }
        public Modern(int a) { }
        [Obsolete("old field", true)]
        public int Count;
        [Obsolete]
        public const int Limit = 3;
        [Obsolete("old property")]
        public int Size { get { return 1; } set { } }
        [Obsolete("old event")]
        public event Action Changed;
        public void Raise() { if (Changed != null) Changed(); }
        [Obsolete("old method")]
        public static void Helper(Legacy legacy) { Legacy.Run(); new Modern(); }
        [Obsolete]
        public static Legacy Create() { return new Legacy(); }
    }
    [Obsolete]
    class AlsoOld
    {
        Legacy field = new Legacy();
        void Use() { Modern.Helper(field); }
    }
    class Holder
    {
        Legacy stored;
        Legacy[] many;
        Legacy Convert(Legacy input) { return input; }
    }
    class Program
    {
        static void Main()
        {
            Modern a = new Modern();
            Modern b = new Modern(1);
            b.Count = 2;
            int limit = Modern.Limit;
            b.Size = b.Size + limit;
            b.Changed += Main;
            Modern.Helper(null);
            Legacy.Run();
            global::Legacy.Run();
            var created = Modern.Create();
        }
    }
    `,
    ),
  ]),
];
