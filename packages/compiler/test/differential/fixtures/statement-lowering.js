/**
 * Differential fixtures for SF-A02-T45 (C# 1 statements lowered through well-known members): lock, using, foreach,
 * checked and unchecked blocks.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('statement-lowering', [
    out(
      'checked-and-unchecked-blocks',
      cs`
    using System;
    class Program
    {
        static int Add(int left, int right)
        {
            checked
            {
                return left + right;
            }
        }
        static void Main()
        {
            int large = 2147483647;
            unchecked
            {
                int wrapped = large + 1;
                Console.WriteLine(wrapped);
                checked
                {
                    try
                    {
                        Console.WriteLine(large * 2);
                    }
                    catch (Exception)
                    {
                        Console.WriteLine("overflow in nested checked");
                    }
                }
                Console.WriteLine(unchecked(large * 2));
            }
            try
            {
                Console.WriteLine(Add(large, 1));
            }
            catch (Exception)
            {
                Console.WriteLine("overflow in method");
            }
            int negated = -2147483647 - 1;
            try
            {
                checked { negated = -negated; }
            }
            catch (Exception)
            {
                Console.WriteLine("overflow in negation");
            }
            unchecked { negated = -negated; }
            Console.WriteLine(negated);
            Console.WriteLine(checked(large - 1) + unchecked(large + large));
        }
    }
  `,
    ),
    out(
      'checked-context-is-lexical',
      cs`
    using System;
    class Program
    {
        delegate int Compute(int value);
        static int Twice(int value)
        {
            return value * 2;
        }
        static void Main()
        {
            int large = 2147483647;
            checked
            {
                Console.WriteLine(Twice(large));
                Compute inline = delegate(int value) { return value + value; };
                try
                {
                    Console.WriteLine(inline(large));
                }
                catch (Exception)
                {
                    Console.WriteLine("the anonymous method is in the checked block");
                }
                int count = large;
                try
                {
                    count++;
                }
                catch (Exception)
                {
                    Console.WriteLine("increment overflow");
                }
                try
                {
                    count += 1;
                }
                catch (Exception)
                {
                    Console.WriteLine("compound overflow");
                }
            }
        }
    }
  `,
    ),
    out(
      'lock-runs-body-and-releases-on-exception',
      cs`
    using System;
    class Counter
    {
        readonly object gate = new object();
        int value;
        public int Next()
        {
            lock (gate)
            {
                value++;
                lock (gate)
                {
                    return value;
                }
            }
        }
        public void Fail()
        {
            lock (this)
            {
                throw new Exception("inside lock");
            }
        }
    }
    class Program
    {
        static void Main()
        {
            Counter counter = new Counter();
            Console.WriteLine(counter.Next());
            Console.WriteLine(counter.Next());
            try
            {
                counter.Fail();
            }
            catch (Exception error)
            {
                Console.WriteLine(error.Message);
            }
            lock (counter) Console.WriteLine(counter.Next());
        }
    }
  `,
    ),
    out(
      'using-statement-forms',
      cs`
    using System;
    class Resource : IDisposable
    {
        string name;
        public Resource(string name)
        {
            this.name = name;
            Console.WriteLine("open " + name);
        }
        public void Dispose()
        {
            Console.WriteLine("close " + name);
        }
    }
    class Program
    {
        static Resource Missing()
        {
            return null;
        }
        static void Main()
        {
            using (Resource first = new Resource("a"), second = new Resource("b"))
            {
                Console.WriteLine("body");
            }
            Resource shared = new Resource("c");
            using (shared)
            {
                Console.WriteLine("expression form");
            }
            using (Resource none = Missing())
            {
                Console.WriteLine("null resource is not disposed");
            }
            try
            {
                using (new Resource("d"))
                {
                    throw new Exception("thrown");
                }
            }
            catch (Exception error)
            {
                Console.WriteLine(error.Message);
            }
        }
    }
  `,
    ),
    diag(
      'lock-requires-a-reference-type',
      cs`
    class Program
    {
        struct Point { }
        static void Main()
        {
            int number = 1;
            Point point = new Point();
            lock (number) { }
            lock (point) { }
            lock (null) { }
            lock ("text") { }
            lock (typeof(Program)) { }
            lock (Missing) { }
        }
        static void Generic<T, U>(T free, U bound) where U : class
        {
            lock (free) { }
            lock (bound) { }
        }
    }
  `,
    ),
    diag(
      'using-requires-idisposable',
      cs`
    using System;
    class NotDisposable
    {
        public void Dispose() { }
    }
    class Resource : IDisposable
    {
        public void Dispose() { }
    }
    class Program
    {
        static void Main()
        {
            using (NotDisposable wrong = new NotDisposable()) { }
            using (new NotDisposable()) { }
            using (Resource right = new Resource())
            {
                right = null;
            }
        }
    }
  `,
    ),
    diag(
      'checked-constant-overflow',
      cs`
    class Program
    {
        const int Large = 2147483647;
        static void Main()
        {
            int a = Large + 1;
            int b = unchecked(Large + 1);
            unchecked
            {
                int c = Large + 1;
                int d = checked(Large + 1);
            }
            checked
            {
                int e = Large * 2;
            }
        }
    }
  `,
    ),
    diag(
      'embedded-statement-rules',
      cs`
    class Program
    {
        static void Main()
        {
            object gate = new object();
            lock (gate)
                int declared = 1;
            lock (gate) ;
            checked
            {
                unchecked { }
            }
        }
    }
  `,
    ),
  ]),
];
