import { cs, feature, out } from './kit.js';

// Native captures are deliberately separate from source-image startup assertions.
export const fixtures = feature('module-initialization', [
  out('plain-main', cs`
    using System;
    using System.Runtime.CompilerServices;
    static class Startup {
      [ModuleInitializer] internal static void Initialize() { Console.WriteLine("module"); }
    }
    class Program { static void Main() { Console.WriteLine("main"); } }
  `),
  out('static-field-main', cs`
    using System;
    using System.Runtime.CompilerServices;
    static class Startup {
      [ModuleInitializer] internal static void Initialize() { Console.WriteLine("module"); }
    }
    class Program {
      static int Value = Initialize();
      static int Initialize() { Console.WriteLine("field"); return 42; }
      static void Main() { Console.WriteLine(Value); }
    }
  `),
  out('static-constructor-main', cs`
    using System;
    using System.Runtime.CompilerServices;
    static class Startup {
      [ModuleInitializer] internal static void Initialize() { Console.WriteLine("module"); }
    }
    class Program {
      static Program() { Console.WriteLine("type"); }
      static void Main() { Console.WriteLine("main"); }
    }
  `),
  out('initializer-calls-entry-type', cs`
    using System;
    using System.Runtime.CompilerServices;
    static class Startup {
      [ModuleInitializer] internal static void Initialize() {
        Console.WriteLine("module-start");
        Program.Touch();
        Console.WriteLine("module-end");
      }
    }
    class Program {
      static int Value;
      static Program() { Value = 42; Console.WriteLine("type"); }
      internal static void Touch() { Console.WriteLine(Value); }
      static void Main() { Console.WriteLine(Value); }
    }
  `),
  out('declaration-order-once', cs`
    using System;
    using System.Runtime.CompilerServices;
    static class State { internal static int Count; }
    static class First {
      [ModuleInitializer] internal static void Initialize() { Console.WriteLine(++State.Count); }
      [ModuleInitializer] internal static void Next() { Console.WriteLine(++State.Count); }
    }
    static class Second {
      [ModuleInitializer] internal static void Initialize() { Console.WriteLine(++State.Count); }
    }
    class Program {
      static void Read() { Console.WriteLine(State.Count); }
      static void Main() { Read(); Read(); }
    }
  `),
  out('pre-entry-fault', cs`
    using System;
    using System.Runtime.CompilerServices;
    static class Startup {
      [ModuleInitializer] internal static void Initialize() {
        Console.WriteLine("module");
        throw new Exception("module failure");
      }
    }
    class Program {
      static void Main() {
        try { Console.WriteLine("main"); }
        catch (Exception) { Console.WriteLine("caught"); }
      }
    }
  `),
  out('no-initializers', cs`
    using System;
    class Program { static void Main() { Console.WriteLine("main"); } }
  `),
]);
