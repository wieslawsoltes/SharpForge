/**
 * Differential fixtures for SF-A02-T43 (C# 1 jumps): `goto` and labels, `goto case` / `goto default`, the
 * no-fall-through rule of switch sections and jumps that may not leave a finally block.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('jumps', [
    out(
      'goto-case-and-default',
      cs`
    using System;
    class Program
    {
        static void Visit(int value)
        {
            switch (value)
            {
                case 1:
                    Console.WriteLine("one");
                    goto case 2;
                case 2:
                    Console.WriteLine("two");
                    goto default;
                case 3:
                    Console.WriteLine("three");
                    break;
                default:
                    Console.WriteLine("default");
                    goto case 3;
            }
        }
        static void Main()
        {
            Visit(1);
            Visit(2);
            Visit(3);
            Visit(9);
        }
    }
  `,
    ),
    out(
      'goto-case-string-and-converted-constant',
      cs`
    using System;
    class Program
    {
        const int Two = 2;
        static void Main()
        {
            string word = "b";
            switch (word)
            {
                case "a":
                    Console.WriteLine("a");
                    break;
                case "b":
                    Console.WriteLine("b");
                    goto case "a";
                case null:
                    Console.WriteLine("null");
                    break;
            }
            int number = 1;
            switch (number)
            {
                case 1:
                    Console.WriteLine(1);
                    goto case Two;
                case 1 + 1:
                    Console.WriteLine(2);
                    break;
            }
        }
    }
  `,
    ),
    out(
      'goto-case-in-nested-switch-and-loop',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            for (int outer = 0; outer < 3; outer++)
            {
                switch (outer)
                {
                    case 0:
                        switch (outer + 5)
                        {
                            case 5:
                                Console.WriteLine("inner 5");
                                goto case 6;
                            case 6:
                                Console.WriteLine("inner 6");
                                break;
                        }
                        goto case 2;
                    case 1:
                        Console.WriteLine("outer 1");
                        continue;
                    case 2:
                        Console.WriteLine("outer 2 at " + outer);
                        break;
                }
                Console.WriteLine("after " + outer);
            }
        }
    }
  `,
    ),
    out(
      'goto-label-backward-and-out-of-loops',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            int count = 0;
        again:
            count++;
            if (count < 3) goto again;
            Console.WriteLine(count);
            for (int row = 0; row < 3; row++)
            {
                for (int column = 0; column < 3; column++)
                {
                    if (row * column == 2) goto found;
                    Console.WriteLine(row + "," + column);
                }
            }
            Console.WriteLine("not found");
        found:
            Console.WriteLine("done");
        }
    }
  `,
    ),
    out(
      'jumps-out-of-try-run-finally',
      cs`
    using System;
    class Program
    {
        static int Leave(int mode)
        {
            for (int pass = 0; pass < 2; pass++)
            {
                try
                {
                    if (mode == 0) goto end;
                    if (mode == 1) break;
                    if (mode == 2) continue;
                    if (mode == 3) return 30;
                    switch (mode)
                    {
                        case 4:
                            try { goto case 5; }
                            finally { Console.WriteLine("inner finally"); }
                        case 5:
                            Console.WriteLine("five");
                            break;
                    }
                }
                finally
                {
                    Console.WriteLine("finally " + mode + " pass " + pass);
                }
            }
            return mode;
        end:
            return -1;
        }
        static void Main()
        {
            for (int mode = 0; mode < 5; mode++) Console.WriteLine(Leave(mode));
        }
    }
  `,
    ),
    diag(
      'switch-fall-through',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            int value = 1;
            switch (value)
            {
                case 1:
                    Console.WriteLine("one");
                case 2:
                case 3:
                    Console.WriteLine("two");
                    break;
                default:
                    Console.WriteLine("last");
            }
        }
    }
  `,
    ),
    diag(
      'jumps-out-of-finally',
      cs`
    class Program
    {
        static int Main()
        {
            for (int i = 0; i < 2; i++)
            {
                try { }
                finally
                {
                    if (i == 0) break;
                    continue;
                }
            }
            try { }
            finally
            {
                return 1;
            }
        }
        static void Goto(int value)
        {
            switch (value)
            {
                case 1:
                    try { }
                    finally
                    {
                        goto case 2;
                    }
                case 2:
                    break;
            }
            try { }
            finally
            {
                goto end;
            }
        end:
            return;
        }
    }
  `,
    ),
    diag(
      'jumps-inside-finally-are-allowed',
      cs`
    class Program
    {
        static void Main()
        {
            int unused;
            try { }
            finally
            {
                for (int i = 0; i < 2; i++)
                {
                    if (i == 0) continue;
                    break;
                }
                goto inside;
            inside:
                switch (1)
                {
                    case 1:
                        goto default;
                    default:
                        break;
                }
            }
        }
    }
  `,
    ),
    diag(
      'label-errors',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            goto missing;
        twice:
            Console.WriteLine(1);
        twice:
            Console.WriteLine(2);
        unused:
            Console.WriteLine(3);
            {
            nested:
                Console.WriteLine(4);
            }
            goto nested;
        }
    }
  `,
    ),
    diag(
      'label-shadows-outer-label',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            int count = 0;
            {
            start:
                Console.WriteLine(1);
                if (count++ < 2) goto start;
            }
        start:
            Console.WriteLine(2);
            if (count++ < 4) goto start;
        }
        static void Lambda()
        {
        outer:
            Action action = delegate
            {
                goto outer;
            };
            action();
            goto outer;
        }
    }
  `,
    ),
    diag(
      'goto-case-errors',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            goto case 1;
            goto default;
            int value = 1;
            switch (value)
            {
                case 1:
                    goto case 7;
                case 2:
                    goto default;
                case 3:
                    goto case value;
                case 4:
                    goto case "four";
                case 5:
                    goto case 2.0;
            }
        }
    }
  `,
    ),
    diag(
      'break-and-continue-outside-loop',
      cs`
    class Program
    {
        static void Main()
        {
            break;
            continue;
            switch (1)
            {
                case 1:
                    continue;
            }
        }
    }
  `,
    ),
    diag(
      'duplicate-case-labels',
      cs`
    class Program
    {
        const int One = 1;
        static void Main()
        {
            int value = 1;
            switch (value)
            {
                case 1:
                    break;
                case One:
                    break;
                default:
                    break;
                default:
                    break;
            }
            switch ("a")
            {
                case "a":
                case "a":
                    break;
            }
        }
    }
  `,
    ),
  ]),
];
