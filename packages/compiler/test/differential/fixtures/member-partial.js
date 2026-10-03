/**
 * Differential fixtures for partial members: partial methods (C# 3), extended partial methods (C# 9) and partial
 * properties and indexers (C# 13) - merging of the two parts, removal of calls to unimplemented methods, and the
 * errors Roslyn reports for missing, repeated or mismatched parts. Also the finalizer policy: a finalizer is
 * compiled and never run, which is what .NET does for a program that ends without a collection.
 */
import { cs, out, diag, feature } from './kit.js';

const partial = [
  out(
    'methods-merge-and-unimplemented-calls-vanish',
    cs`
    using System;
    partial class Widget
    {
        partial void Hook(int x);
        partial void Missing(int x);
        public partial int Twice(int x);
        static partial void Shared(string text);
        public void Run()
        {
            Hook(1);
            Missing(Log());
            Shared("s");
            Console.WriteLine(Twice(4));
        }
        static int Log() { Console.WriteLine("evaluated"); return 2; }
    }
    partial class Widget
    {
        partial void Hook(int x) { Console.WriteLine("hook " + x); }
        public partial int Twice(int x) => x * 2;
        static partial void Shared(string text) { Console.WriteLine("shared " + text); }
    }
    class Program { static void Main() { new Widget().Run(); } }
  `,
  ),
  out(
    'defaults-come-from-the-defining-part',
    cs`
    using System;
    partial class Report
    {
        public partial string Line(string text, int width = 3, string pad = ".");
    }
    partial class Report
    {
        public partial string Line(string text, int width, string pad)
        {
            string result = text;
            for (int i = 0; i < width; i++) result += pad;
            return result;
        }
    }
    class Program
    {
        static void Main()
        {
            var r = new Report();
            Console.WriteLine(r.Line("a"));
            Console.WriteLine(r.Line("b", 1));
            Console.WriteLine(r.Line(pad: "!", text: "c"));
        }
    }
  `,
  ),
  out(
    'properties-and-indexers',
    cs`
    using System;
    partial class Settings
    {
        public partial int Value { get; set; }
        public partial string Name { get; }
        public partial int this[int i] { get; }
        public static partial int Count { get; set; }
    }
    partial class Settings
    {
        int stored;
        static int count;
        public partial int Value { get => stored; set => stored = value * 2; }
        public partial string Name => "settings";
        public partial int this[int i] => i + stored;
        public static partial int Count { get { return count; } set { count = value + 1; } }
    }
    class Program
    {
        static void Main()
        {
            var s = new Settings();
            s.Value = 4;
            s.Value += 1;
            Settings.Count = 5;
            Console.WriteLine(s.Value + " " + s.Name + " " + s[1] + " " + Settings.Count);
        }
    }
  `,
  ),
  out(
    'finalizer-is-not-run-at-exit',
    cs`
    using System;
    class Resource
    {
        ~Resource() { Console.WriteLine("finalized"); }
        public void Use() { Console.WriteLine("used"); }
    }
    class Program
    {
        static void Main()
        {
            new Resource().Use();
            Console.WriteLine("done");
        }
    }
  `,
  ),
  diag(
    'missing-parts',
    cs`
    partial class A
    {
        partial void OnlyImplementation() { }
        public partial int NeedsImplementation(int x);
        partial void Fine();
        internal partial void AlsoNeedsImplementation();
        partial void WithOut(out int x);
    }
    class Program { static void Main() { } }
  `,
  ),
  diag(
    'repeated-parts',
    cs`
    partial class A
    {
        partial void M();
        partial void M();
        partial void N() { }
        partial void N() { }
        partial void N();
    }
    class Program { static void Main() { } }
  `,
  ),
  diag(
    'mismatched-parts',
    cs`
    partial class A
    {
        public partial int R(int x);
        public partial string R(int x) { return ""; }
        public partial void S();
        public static partial void S() { }
        public partial void T(int a);
        public partial void T(int b) { }
        public partial void U();
        internal partial void U() { }
    }
    class Program { static void Main() { } }
  `,
  ),
  diag(
    'partial-method-rules',
    cs`
    class NotPartial
    {
        partial void M();
    }
    partial class A
    {
        partial int NoAccessibility();
        partial int NoAccessibility() { return 0; }
    }
    class Program { static void Main() { } }
  `,
  ),
  diag(
    'unimplemented-partial-method-uses',
    cs`
    partial class A
    {
        partial void M(int x);
        void Use()
        {
            System.Action<int> a = M;
            int unused;
            M(unused = 1);
        }
    }
    class Program { static void Main() { } }
  `,
  ),
  diag(
    'partial-property-errors',
    cs`
    partial class A
    {
        public partial int OnlyDefinition { get; set; }
        public partial int OnlyImplementation { get => 0; }
        public partial int Twice { get; }
        public partial int Twice { get; }
        public partial int Accessors { get; set; }
        public partial int Accessors { get => 0; }
        public partial int Types { get; }
        public partial string Types => "";
    }
    class Program { static void Main() { } }
  `,
  ),
  diag(
    'extended-partial-language-version',
    cs`
    partial class A
    {
        public partial int M();
        public partial int M() { return 0; }
    }
    class Program { static void Main() { } }
  `,
    { langVersion: '8' },
  ),
];

export const fixtures = feature('member-partial', partial);
