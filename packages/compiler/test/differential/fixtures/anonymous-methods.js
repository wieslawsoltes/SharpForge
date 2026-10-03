/**
 * Differential fixtures for SF-A02-T51 (C# 2 anonymous methods) and SF-A02-T47 (C# 1 string operations and switch on
 * string): what already executes through the semantic generator is pinned against .NET, the rules against Roslyn.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('anonymous-methods', [
    out(
      'parameterless-form-fits-any-signature',
      cs`
    using System;
    delegate int Combine(int left, int right);
    delegate void Notify(string message);
    delegate bool Check();
    class Program
    {
        static int Apply(Combine combine, int left, int right)
        {
            return combine(left, right);
        }
        static void Main()
        {
            Combine constant = delegate { return 42; };
            Combine sum = delegate(int left, int right) { return left + right; };
            Notify silent = delegate { Console.WriteLine("notified"); };
            Check always = delegate { return true; };
            Console.WriteLine(constant(1, 2));
            Console.WriteLine(Apply(sum, 3, 4));
            Console.WriteLine(Apply(delegate { return -1; }, 5, 6));
            silent("ignored");
            Console.WriteLine(always());
        }
    }
  `,
    ),
    out(
      'captures-and-multicast',
      cs`
    using System;
    delegate void Step();
    delegate int Next();
    class Program
    {
        static Next Counter(int start)
        {
            int current = start;
            return delegate { current++; return current; };
        }
        static void Main()
        {
            Next first = Counter(10), second = Counter(100);
            Console.WriteLine(first() + " " + first() + " " + second());
            string log = "";
            Step steps = delegate { log += "a"; };
            steps += delegate { log += "b"; };
            Step last = delegate { log += "c"; };
            steps += last;
            steps();
            steps -= last;
            steps();
            Console.WriteLine(log);
        }
    }
  `,
    ),
    diag(
      'signature-rules',
      cs`
    delegate void WithOut(out int value);
    delegate int Returns(int value);
    delegate void Plain(int value);
    class Program
    {
        static void Main()
        {
            WithOut parameterless = delegate { };
            WithOut assigned = delegate(out int value) { value = 1; };
            WithOut wrongKind = delegate(int value) { };
            Returns wrongCount = delegate(int a, int b) { return a; };
            Returns wrongType = delegate(string text) { return 1; };
            Returns noValue = delegate(int value) { };
            Plain returnsValue = delegate(int value) { return value; };
            int notADelegate = delegate { };
            object boxed = delegate { };
        }
    }
  `,
    ),
    diag(
      'body-rules',
      cs`
    delegate void Step();
    delegate int Next(int value);
    class Program
    {
        static void Run(ref int byRef, out int result)
        {
            result = 0;
            int local = 1;
            Step captureRef = delegate { byRef++; };
            Step captureOut = delegate { result++; };
            Next shadow = delegate(int local) { return local; };
            Next redeclare = delegate(int value) { int value = 1; return value; };
            Step unassigned = delegate { int inner; inner++; };
            captureRef();
        }
        static void Main() { }
    }
  `,
    ),
  ]),
  ...feature('string-operations', [
    out(
      'concatenation-and-equality',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            string empty = null;
            string greeting = "hello";
            Console.WriteLine(greeting + " " + 1 + 2 + true + 1.5);
            Console.WriteLine(1 + 2 + greeting);
            Console.WriteLine("[" + empty + "]" + null);
            Console.WriteLine(greeting == "hel" + "lo");
            Console.WriteLine(greeting != null);
            Console.WriteLine(empty == null);
            string built = "";
            for (int i = 0; i < 3; i++) built += i;
            Console.WriteLine(built);
            Console.WriteLine(greeting.Length + built.Length);
        }
    }
  `,
    ),
    out(
      'switch-on-string',
      cs`
    using System;
    class Program
    {
        const string Stop = "stop";
        static int Code(string word)
        {
            switch (word)
            {
                case "go":
                case "start":
                    return 1;
                case Stop:
                    return 2;
                case "":
                    return 3;
                case null:
                    return 4;
                default:
                    return 0;
            }
        }
        static void Main()
        {
            Console.WriteLine(Code("go") + " " + Code("start") + " " + Code("stop"));
            Console.WriteLine(Code("") + " " + Code(null) + " " + Code("GO") + " " + Code("st" + "op"));
        }
    }
  `,
    ),
  ]),
];
