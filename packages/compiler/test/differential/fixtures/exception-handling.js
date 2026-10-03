/**
 * Differential fixtures for SF-A02-T44 (C# 1 exception handling): catch clauses of any exception type and their
 * ordering, rethrow, what may be thrown, and the order in which catch and finally blocks run.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('exception-handling', [
    out(
      'catch-finally-order-and-rethrow',
      cs`
    using System;
    class Program
    {
        static void Fail(string message)
        {
            throw new Exception(message);
        }
        static int Guarded(int mode)
        {
            try
            {
                Console.WriteLine("try " + mode);
                if (mode == 1) Fail("one");
                if (mode == 2) return 20;
                return 0;
            }
            catch (Exception error)
            {
                Console.WriteLine("catch " + error.Message);
                return 10;
            }
            finally
            {
                Console.WriteLine("finally " + mode);
            }
        }
        static void Main()
        {
            for (int mode = 0; mode < 3; mode++) Console.WriteLine(Guarded(mode));
            try
            {
                try
                {
                    Fail("inner");
                }
                catch
                {
                    Console.WriteLine("general");
                    throw;
                }
                finally
                {
                    Console.WriteLine("inner finally");
                }
            }
            catch (Exception outer)
            {
                Console.WriteLine("outer " + outer.Message);
            }
        }
    }
  `,
    ),
    out(
      'exception-in-catch-and-finally-replaces',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            try
            {
                try
                {
                    throw new Exception("first");
                }
                catch (Exception first)
                {
                    throw new Exception("second after " + first.Message);
                }
                finally
                {
                    Console.WriteLine("finally runs");
                }
            }
            catch (Exception second)
            {
                Console.WriteLine(second.Message);
            }
            try
            {
                try
                {
                    throw new Exception("lost");
                }
                finally
                {
                    throw new Exception("from finally");
                }
            }
            catch (Exception replaced)
            {
                Console.WriteLine(replaced.Message);
            }
        }
    }
  `,
    ),
    out(
      'typed-catch-selects-by-type',
      cs`
    using System;
    class Program
    {
        static string Classify(int mode)
        {
            try
            {
                if (mode == 0) throw new ArgumentNullException("value");
                if (mode == 1) throw new ArgumentException("bad argument");
                if (mode == 2) throw new InvalidOperationException("bad state");
                if (mode == 3) throw new Exception("plain");
                return "none";
            }
            catch (ArgumentNullException)
            {
                return "null argument";
            }
            catch (ArgumentException error)
            {
                return "argument: " + error.Message;
            }
            catch (InvalidOperationException error)
            {
                return "operation: " + error.Message;
            }
            catch (Exception error)
            {
                return "other: " + error.Message;
            }
        }
        static void Main()
        {
            for (int mode = 0; mode < 5; mode++) Console.WriteLine(Classify(mode));
        }
    }
  `,
    ),
    out(
      'typed-catch-of-runtime-exceptions',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            int zero = 0;
            int[] numbers = new int[2];
            string text = null;
            try { Console.WriteLine(1 / zero); }
            catch (DivideByZeroException) { Console.WriteLine("divide"); }
            try { numbers[2] = 1; }
            catch (IndexOutOfRangeException) { Console.WriteLine("index"); }
            try { Console.WriteLine(text.Length); }
            catch (NullReferenceException) { Console.WriteLine("null"); }
            try { Console.WriteLine(1 % zero); }
            catch (ArithmeticException) { Console.WriteLine("arithmetic"); }
            try { Console.WriteLine(int.Parse("x")); }
            catch (FormatException) { Console.WriteLine("format"); }
        }
    }
  `,
    ),
    out(
      'user-defined-exception',
      cs`
    using System;
    class ParseError : Exception
    {
        public int Line;
        public ParseError(string message, int line) : base(message)
        {
            Line = line;
        }
    }
    class FatalParseError : ParseError
    {
        public FatalParseError(int line) : base("fatal", line) { }
    }
    class Program
    {
        static void Parse(int line)
        {
            if (line > 5) throw new FatalParseError(line);
            if (line > 2) throw new ParseError("unexpected token", line);
        }
        static void Main()
        {
            for (int line = 2; line < 8; line += 2)
            {
                try
                {
                    Parse(line);
                    Console.WriteLine("ok " + line);
                }
                catch (FatalParseError error)
                {
                    Console.WriteLine("fatal at " + error.Line);
                }
                catch (ParseError error)
                {
                    Console.WriteLine(error.Message + " at " + error.Line);
                }
            }
        }
    }
  `,
    ),
    out(
      'inner-exception-and-unhandled-in-nested-try',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            try
            {
                try
                {
                    throw new InvalidOperationException("inner");
                }
                catch (ArgumentException)
                {
                    Console.WriteLine("not reached");
                }
                finally
                {
                    Console.WriteLine("inner finally");
                }
            }
            catch (InvalidOperationException error)
            {
                Exception wrapped = new Exception("outer", error);
                Console.WriteLine(wrapped.Message + " <- " + wrapped.InnerException.Message);
                Console.WriteLine(wrapped.InnerException is InvalidOperationException);
            }
        }
    }
  `,
    ),
    diag(
      'catch-order',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            try { }
            catch (Exception) { }
            catch (ArgumentException) { }
            try { }
            catch (ArgumentException) { }
            catch (ArgumentNullException) { }
            catch (ArgumentException) { }
            catch (InvalidOperationException) { }
            catch (SystemException) { }
            catch (Exception) { }
            catch { }
            try { }
            catch { }
            catch (Exception) { }
            try { }
            catch { }
            catch { }
        }
    }
  `,
    ),
    diag(
      'catch-order-with-source-hierarchy',
      cs`
    using System;
    class Base : Exception { }
    class Derived : Base { }
    class Other : Exception { }
    class Program
    {
        static void Main()
        {
            try { }
            catch (Base) { }
            catch (Other) { }
            catch (Derived) { }
        }
        static void Generic<T>() where T : Exception
        {
            try { }
            catch (T) { }
            catch (Exception) { }
            try { }
            catch (Exception) { }
            catch (T) { }
        }
    }
  `,
    ),
    diag(
      'caught-and-thrown-types',
      cs`
    using System;
    class NotAnException { }
    class Program
    {
        static void Main()
        {
            try { }
            catch (int) { }
            catch (string text) { Console.WriteLine(text); }
            catch (NotAnException) { }
            catch (object) { }
        }
        static void Throwing(Exception error, object value)
        {
            if (value == null) throw new NotAnException();
            if (value == error) throw 1;
            if (error == null) throw value;
            if (error != null) throw null;
            throw "text";
        }
    }
  `,
    ),
    diag(
      'rethrow-placement',
      cs`
    using System;
    class Program
    {
        delegate void Step();
        static void Main()
        {
            throw;
        }
        static void InFinally()
        {
            try { }
            catch
            {
                try { }
                finally
                {
                    throw;
                }
            }
            try { }
            finally
            {
                throw;
            }
        }
        static void InLambda()
        {
            try { }
            catch
            {
                Step step = delegate { throw; };
                step();
                try { throw; }
                catch { throw; }
            }
        }
    }
  `,
    ),
    diag(
      'catch-variable-scope-and-use',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            int error = 0;
            try { }
            catch (Exception error) { }
            try { }
            catch (Exception unused) { }
            catch (ArgumentException) when (error > 0) { }
            try { }
            catch (Exception first)
            {
                first = null;
                Console.WriteLine(first);
            }
            Console.WriteLine(first);
        }
    }
  `,
      { langVersion: '6' },
    ),
    diag(
      'unreachable-after-throw-and-try',
      cs`
    using System;
    class Program
    {
        static int Main()
        {
            try
            {
                throw new Exception("always");
                Console.WriteLine("after throw");
            }
            catch (Exception)
            {
                return 1;
            }
            finally
            {
                Console.WriteLine("finally");
            }
            Console.WriteLine("after try");
        }
        static int NoReturn(bool flag)
        {
            try
            {
                if (flag) return 1;
            }
            catch (Exception)
            {
            }
        }
    }
  `,
    ),
  ]),
];
