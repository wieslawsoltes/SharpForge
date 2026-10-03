/**
 * Differential fixtures for SF-A02-T74 (C# 10 global using directives and file-scoped namespaces). The rules that
 * need several files (a global using of one file seen in another, duplicate global aliases, implicit usings) are in
 * tests/compiler-global-usings.test.js.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('global-usings', [
    out(
      'namespace-static-and-alias',
      cs`
    global using Con = System.Console;
    global using static System.Math;
    global using System;
    class Program
    {
        static void Main() { Con.WriteLine(Max(1, 2)); Console.WriteLine(Abs(-3)); }
    }
  `,
    ),
    diag(
      'cs8915-after-a-using',
      cs`
    using System;
    global using System.Text;
    global using System.Collections.Generic;
    class Program { static void Main() { } }
  `,
    ),
    diag(
      'cs8914-in-a-namespace',
      cs`
    namespace N { global using System; class C { } }
    class Program { static void Main() { } }
  `,
    ),
    diag(
      'cs8914-in-a-file-scoped-namespace',
      cs`
    namespace N;
    global using System;
    class Program { static void Main() { } }
  `,
    ),
    diag(
      'cs0105-repeated-in-one-file',
      cs`
    global using System;
    global using System;
    using System;
    class Program { static void Main() { Console.WriteLine(1); } }
  `,
    ),
    diag(
      'cs1537-alias-declared-twice',
      cs`
    global using A = System.Console;
    using A = System.Math;
    class Program { static void Main() { A.WriteLine(1); } }
  `,
    ),
    diag(
      'global-using-in-csharp-9',
      cs`
    global using System;
    class Program { static void Main() { } }
  `,
      { langVersion: '9' },
    ),
  ]),
  ...feature('file-scoped-namespaces', [
    out(
      'types-and-usings-inside',
      cs`
    using System;
    namespace App.Core;
    using System.Collections.Generic;
    class Box { public List<int> Items = new List<int>(); public static int Version = 4; }
    class Program
    {
        static void Main()
        {
            var box = new Box();
            box.Items.Add(3);
            Console.WriteLine(box.Items.Count);
            Console.WriteLine(new App.Core.Box().Items.Count);
            Console.WriteLine(App.Core.Box.Version + Box.Version);
        }
    }
  `,
    ),
    diag(
      'cs8954-two-file-scoped-namespaces',
      cs`
    namespace N;
    namespace M;
    class Program { static void Main() { } }
  `,
    ),
    diag(
      'cs8955-cs8956-mixed-with-block-namespaces',
      cs`
    namespace M;
    namespace N { }
    class Program { static void Main() { } }
  `,
    ),
    diag(
      'cs8956-after-a-member',
      cs`
    class A { }
    namespace M;
    class Program { static void Main() { } }
  `,
    ),
    diag(
      'cs8956-after-top-level-statements',
      cs`
    System.Console.WriteLine(1);
    namespace M;
    class P { }
  `,
    ),
    diag(
      'cs1529-using-after-a-type',
      cs`
    namespace M;
    class A { }
    using System;
    class Program { static void Main() { } }
  `,
    ),
    diag(
      'file-scoped-namespace-in-csharp-9',
      cs`
    namespace M;
    class Program { static void Main() { } }
  `,
      { langVersion: '9' },
    ),
  ]),
];
