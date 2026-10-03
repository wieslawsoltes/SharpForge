/**
 * Differential fixtures for SF-A02-T52 (C# 2 conditional methods): calls to `[Conditional]` methods are omitted
 * unless one of the symbols is defined, and the rules for declaring such a method.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('conditional-methods', [
    out(
      'calls-are-omitted-with-their-arguments',
      cs`
    #define TRACE_ON
    using System;
    using System.Diagnostics;
    class Log
    {
        [Conditional("TRACE_ON")]
        public static void Trace(string message)
        {
            Console.WriteLine("trace " + message);
        }
        [Conditional("VERBOSE")]
        public static void Verbose(string message)
        {
            Console.WriteLine("verbose " + message);
        }
        [Conditional("VERBOSE"), Conditional("TRACE_ON")]
        public static void Either(string message)
        {
            Console.WriteLine("either " + message);
        }
        [ConditionalAttribute("VERBOSE")]
        public void Instance(int value)
        {
            Console.WriteLine("instance " + value);
        }
    }
    class Program
    {
        static int evaluations;
        static string Describe(string text)
        {
            evaluations++;
            return text;
        }
        static void Main()
        {
            Log.Trace(Describe("one"));
            Log.Verbose(Describe("two"));
            Log.Either(Describe("three"));
            new Log().Instance(evaluations++);
            Console.WriteLine(evaluations);
        }
    }
  `,
    ),
    out(
      'undef-removes-a-symbol',
      cs`
    #define FIRST
    #define SECOND
    #undef FIRST
    using System;
    class Program
    {
        [System.Diagnostics.Conditional("FIRST")]
        static void First() { Console.WriteLine("first"); }
        [System.Diagnostics.Conditional("SECOND")]
        static void Second() { Console.WriteLine("second"); }
        static void Main()
        {
            First();
            Second();
            Console.WriteLine("done");
        }
    }
  `,
    ),
    diag(
      'declaration-rules',
      cs`
    using System.Diagnostics;
    interface IShape
    {
        [Conditional("DEBUG")] void Draw();
    }
    class Base
    {
        public virtual void Run() { }
    }
    class Program : Base
    {
        [Conditional("DEBUG")] static int Count() { return 1; }
        [Conditional("DEBUG")] static void Fill(out int value) { value = 1; }
        [Conditional("DEBUG")] public override void Run() { }
        [Conditional("DEBUG")] Program() { }
        [Conditional("not an identifier")] static void Named() { }
        [Conditional("DEBUG")] static void Fine(ref int value, int other) { }
        static void Main() { }
    }
  `,
    ),
  ]),
];
