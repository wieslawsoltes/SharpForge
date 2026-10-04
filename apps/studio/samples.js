import {release14Samples} from './samples-release14.js';
import {release13Samples} from './samples-release13.js';
import {designerSamples} from './samples-designer.js';
export const samples=[
 {id:'particles',name:'Particle simulation',description:'Multiple files, objects, arrays and source-level debugging.',files:[
 {uri:'Program.cs',text:`using System;

// A real C# program. Compiled and executed entirely in JavaScript.
class Program
{
    static int Integrate(Particle particle, int step)
    {
        particle.Position += particle.Velocity * step;
        return particle.Position;
    }

    static void Main()
    {
        Console.WriteLine("SharpForge • particle simulation");

        Particle[] particles = new Particle[] {
            new Particle("Aurora", 12, 3),
            new Particle("Orion", 24, 5),
            new Particle("Vega", 8, 2)
        };

        int total = 0;
        for (int tick = 0; tick < 4; tick++)
        {
            foreach (Particle particle in particles)
            {
                total += Integrate(particle, tick);
            }
            Console.WriteLine("Tick " + tick + " → energy: " + total);
        }

        Console.WriteLine("Managed memory: " + GC.GetTotalMemory(false) + " bytes");
        GC.Collect();
        Console.WriteLine("Simulation complete.");
    }
}
`},
 {uri:'Particle.cs',text:`// Managed objects live on SharpForge's own tracing heap.
class Particle
{
    public string Name;
    public int Position;
    public int Velocity;

    public Particle(string name, int position, int velocity)
    {
        Name = name;
        Position = position;
        Velocity = velocity;
    }

    public string Describe()
    {
        return Name + " at " + Position;
    }
}
`}]},
 {id:'gc',name:'Garbage collection',description:'Create an object cycle, drop the roots, and reclaim it.',files:[{uri:'Program.cs',text:`using System;

class Node
{
    public Node Next;
    public int Value;
}

class Program
{
    static void Main()
    {
        var first = new Node();
        var second = new Node();
        first.Value = 10;
        second.Value = 20;
        first.Next = second;
        second.Next = first;

        Console.WriteLine("Before: " + GC.GetTotalMemory(false) + " bytes");
        first = null;
        second = null;

        // The cycle has no roots. The collector traces and reclaims it.
        GC.Collect();
        Console.WriteLine("Collections: " + GC.CollectionCount(0));
        Console.WriteLine("After: " + GC.GetTotalMemory(false) + " bytes");
    }
}
`}]},
 {id:'recursion',name:'Recursion & call stacks',description:'Step into Fibonacci, inspect frames, and edit a local.',files:[{uri:'Program.cs',text:`using System;

class Program
{
    static int Fibonacci(int n)
    {
        if (n < 2)
        {
            return n;
        }
        return Fibonacci(n - 1) + Fibonacci(n - 2);
    }

    static void Main()
    {
        int count = 10;
        for (int i = 0; i < count; i++)
        {
            int value = Fibonacci(i);
            Console.WriteLine("fib(" + i + ") = " + value);
        }
    }
}
`}]},
 {id:'exceptions',name:'Managed exceptions',description:'Pause on throw, inspect an exception, then enter catch.',files:[{uri:'Program.cs',text:`using System;

class Program
{
    static int Divide(int numerator, int denominator)
    {
        return numerator / denominator;
    }

    static void Main()
    {
        try
        {
            int divisor = 0;
            int result = Divide(42, divisor);
            Console.WriteLine(result);
        }
        catch (Exception error)
        {
            Console.WriteLine("Caught: " + error.Message);
        }
        Console.WriteLine("Execution recovered safely.");
    }
}
`}]},
 {id:'arrays',name:'Arrays & algorithms',description:'An in-place sort using managed array reads and writes.',files:[{uri:'Program.cs',text:`using System;

int[] values = new int[] { 42, 7, 19, 3, 28, 11 };

for (int i = 0; i < values.Length - 1; i++)
{
    for (int j = 0; j < values.Length - i - 1; j++)
    {
        if (values[j] > values[j + 1])
        {
            int temporary = values[j];
            values[j] = values[j + 1];
            values[j + 1] = temporary;
        }
    }
}

foreach (int value in values)
{
    Console.WriteLine(value);
}
`}]},
 {id:'errors',name:'Error recovery',description:'Broken source still yields a syntax tree and useful diagnostics.',files:[{uri:'Program.cs',text:`using System;

// Fix the errors below. Diagnostics update as you type.
int count = "not an integer";
int missing;

Console.WriteLine(missing);
Console.WriteLine(unknownName);

// The editor remains usable even while the program is incomplete.
Console.WriteLine("Ready when you are.");
`}]},
{"id":"partial","name":"Partial classes & nameof","description":"A class split across files, bound member names, and cross-file calls.","expectedOutput":"Add\n42\n","files":[{"uri":"Program.cs","text":"class Program\n{\n    static void Main()\n    {\n        Console.WriteLine(nameof(Calculator.Add));\n        Console.WriteLine(Calculator.Add(20, 22));\n    }\n}\n"},{"uri":"Calculator.cs","text":"public partial class Calculator\n{\n    public static int Add(int a, int b) { return a + b + Bias; }\n}\n"},{"uri":"Calculator.State.cs","text":"public partial class Calculator\n{\n    public static int Bias = 0;\n}\n"}]},
{"id":"switch","name":"Switch statements & expressions","description":"Grouped constants, defaults, string arms, and loop continue.","expectedOutput":"one\nsmall\nsmall\nother\n","files":[{"uri":"Program.cs","text":"for (int n = 1; n < 5; n++)\n{\n    string label = n switch { 1 => \"one\", 2 => \"small\", 3 => \"small\", _ => \"other\" };\n    switch (n)\n    {\n        case 1:\n        case 2:\n        case 3:\n            Console.WriteLine(label);\n            break;\n        default:\n            Console.WriteLine(\"other\");\n            break;\n    }\n}\n"}]},
{"id":"conversions","name":"Conversions & unchecked arithmetic","description":"Explicit numeric casts, typed defaults, and Int32 wraparound.","expectedOutput":"3\n1.5\n0\nFalse\n-2147483648\n","files":[{"uri":"Program.cs","text":"Console.WriteLine((int)3.9);\nConsole.WriteLine((double)3 / 2);\nConsole.WriteLine(default(int));\nConsole.WriteLine(default(bool));\nint maximum = 2147483647;\nConsole.WriteLine(unchecked(maximum + 1));\n"}]},
{"id":"null-assignment","name":"Null-coalescing assignment","description":"Only initialize missing local, field, and array values.","expectedOutput":"local\nfield\narray\n","files":[{"uri":"Program.cs","text":"string text = null;\ntext ??= \"local\";\ntext ??= \"ignored\";\nvar message = new Message();\nmessage.Text ??= \"field\";\nstring[] values = new string[1];\nvalues[0] ??= \"array\";\nConsole.WriteLine(text);\nConsole.WriteLine(message.Text);\nConsole.WriteLine(values[0]);\nclass Message { public string Text; }\n"}]},
{"id":"call-hierarchy","name":"Call hierarchy & rename","description":"Open Call Hierarchy on a method. Explore incoming/outgoing source calls.","expectedOutput":"42\n","files":[{"uri":"Program.cs","text":"class Program\n{\n    static int Add(int a, int b) { return a + b; }\n    static int Twice(int value) { return Add(value, value); }\n    static void Main() { Console.WriteLine(Twice(21)); }\n}\n"}]},
{"id": "guarded-calls", "name": "Guarded calls & exception recovery", "description": "Nested source calls throw a managed exception that a caller catches.", "expectedOutput": "invalid input\n42\n", "files": [{"uri": "Program.cs", "text": "class Program\n{\n    static int Validate(int value)\n    {\n        if (value < 0) throw new Exception(\"invalid input\");\n        return value;\n    }\n    static void Main()\n    {\n        try { Console.WriteLine(Validate(-1)); }\n        catch (Exception error) { Console.WriteLine(error.Message); }\n        Console.WriteLine(Validate(42));\n    }\n}\n"}]},
{"id":"short-circuit","name":"Short-circuit evaluation","description":"Boolean operands run only when needed; conditional expressions pick one arm.","expectedOutput":"False\nTrue\n0\nyes\n","files":[{"uri":"Program.cs","text":"int count = 0;\nbool first = false && ++count > 0;\nbool second = true || ++count > 0;\nConsole.WriteLine(first);\nConsole.WriteLine(second);\nConsole.WriteLine(count);\nConsole.WriteLine(second ? \"yes\" : \"no\");\n"}]},
{"id":"nameof","name":"Compile-time symbol names","description":"Unassigned locals can be named without being read, and rename updates bound names.","expectedOutput":"unassigned\nValue\n","files":[{"uri":"Program.cs","text":"int unassigned;\nConsole.WriteLine(nameof(unassigned));\nConsole.WriteLine(nameof(Record.Value));\nclass Record { public int Value; }\n"}]},
{"id": "properties", "name": "Properties & computed accessors", "description": "Auto-properties, private setters, initializer values, and computed getters.", "expectedOutput": "7\n18\n9\n", "files": [{"uri": "Program.cs", "text": "var counter = new Counter();\nConsole.WriteLine(counter.Value);\ncounter.Add(2);\nConsole.WriteLine(counter.Doubled);\nConsole.WriteLine(counter.Value);\nclass Counter\n{\n    public int Value { get; private set; } = 7;\n    public int Doubled => Value * 2;\n    public void Add(int amount) { Value += amount; }\n}\n"}]},
{"id": "readonly-properties", "name": "Constructor-owned properties", "description": "Getter-only auto-properties initialized in the owning constructor.", "expectedOutput": "Ada\n42\n", "files": [{"uri": "Program.cs", "text": "var record = new Record(\"Ada\", 42);\nConsole.WriteLine(record.Name);\nConsole.WriteLine(record.Id);\nclass Record\n{\n    public string Name { get; }\n    public int Id { get; }\n    public Record(string name, int id) { Name = name; Id = id; }\n}\n"}]},
{"id": "finally", "name": "Finally & nested unwinding", "description": "Cleanup runs for return, throw, and caught exceptions; step through with F11.", "expectedOutput": "cleanup\n42\ninner cleanup\nfailure\nouter cleanup\n", "files": [{"uri": "Program.cs", "text": "int Work()\n{\n    try { return 42; }\n    finally { Console.WriteLine(\"cleanup\"); }\n}\nConsole.WriteLine(Work());\ntry\n{\n    try { throw new Exception(\"failure\"); }\n    finally { Console.WriteLine(\"inner cleanup\"); }\n}\ncatch (Exception error) { Console.WriteLine(error.Message); }\nfinally { Console.WriteLine(\"outer cleanup\"); }\n"}]},
{"id": "finally-loop", "name": "Cleanup on loop exits", "description": "Continue and break unwind protected regions without losing loop state.", "expectedOutput": "cleanup 0\n1\ncleanup 1\ncleanup 2\ndone\n", "files": [{"uri": "Program.cs", "text": "for (int i = 0; i < 4; i++)\n{\n    try\n    {\n        if (i == 0) continue;\n        if (i == 2) break;\n        Console.WriteLine(i);\n    }\n    finally { Console.WriteLine(\"cleanup \" + i); }\n}\nConsole.WriteLine(\"done\");\n"}]},
{"id": "structural-refactoring", "name": "Structural refactorings", "description": "Ctrl+. on a property/local/if; select a whole initializer to introduce a local.", "expectedOutput": "18\npositive\n", "files": [{"uri": "Program.cs", "text": "int amount = 6;\nvar counter = new Counter();\nint total = amount * counter.Value;\nConsole.WriteLine(total);\nif (total > 0) { Console.WriteLine(\"positive\"); }\nelse { Console.WriteLine(\"nonpositive\"); }\nclass Counter { public int Value { get; set; } = 3; }\n"}]},
{"id": "safe-watches", "name": "Safe property watches & GC", "description": "Pause before the final output; inspect row.Value and retaining paths without getter execution.", "expectedOutput": "42\n", "files": [{"uri": "Program.cs", "text": "var row = new Row();\nGC.Collect();\nConsole.WriteLine(row.Value);\nclass Row\n{\n    public int Value { get; set; } = 42;\n    public int Unsafe { get { throw new Exception(\"Watches must not execute this getter\"); } }\n}\n"}]},
{"id": "analyzer-tasks", "name": "Analyzer diagnostics", "description": "Enable analyzers for task-comment hints and literal-condition information.", "expectedOutput": "ready\n", "files": [{"uri": "Program.cs", "text": "// TODO: review the condition before shipping.\nif (false) { Console.WriteLine(\"not reached\"); }\n/* FIXME: replace this demonstration with project logic. */\nConsole.WriteLine(\"ready\");\n"}]},
{"id": "checked-arithmetic", "name": "Checked arithmetic & casts", "description": "Real overflow MSIL, catchable failures, and lexically nested unchecked operations.", "expectedOutput": "addition overflow\nmultiplication overflow\n-2147483648\nconversion overflow\n", "files": [{"uri": "Program.cs", "text": "int maximum = 2147483647;\ntry { checked { Console.WriteLine(maximum + 1); } }\ncatch (Exception error) { Console.WriteLine(\"addition overflow\"); }\nint factor = 50000;\ntry { Console.WriteLine(checked(factor * factor)); }\ncatch (Exception error) { Console.WriteLine(\"multiplication overflow\"); }\nchecked { Console.WriteLine(unchecked(maximum + 1)); }\ndouble outside = 2147483648.0;\ntry { Console.WriteLine(checked((int)outside)); }\ncatch (Exception error) { Console.WriteLine(\"conversion overflow\"); }\n"}]},
{"id": "using-resources", "name": "Using resources & deterministic cleanup", "description": "Concrete IDisposable classes, reverse-order cleanup, and return-time disposal.", "expectedOutput": "acquire outer\nacquire inner\nbody\ndispose inner\ndispose outer\n42\n", "files": [{"uri": "Program.cs", "text": "int Work()\n{\n    using var outer = new Lease(\"outer\");\n    using (var inner = new Lease(\"inner\"))\n    {\n        Console.WriteLine(\"body\");\n        return 42;\n    }\n}\nConsole.WriteLine(Work());\nclass Lease : IDisposable\n{\n    public string Name { get; }\n    public Lease(string name) { Name = name; Console.WriteLine(\"acquire \" + name); }\n    public void Dispose() { Console.WriteLine(\"dispose \" + Name); }\n}\n"}]},
{"id": "using-failure", "name": "Resource cleanup on acquisition failure", "description": "An earlier lease is disposed when the next acquisition throws; null resources are skipped.", "expectedOutput": "acquire outer\ndispose outer\nacquisition failed\nnull skipped\n", "files": [{"uri": "Program.cs", "text": "Lease Fail() { throw new Exception(\"acquisition failed\"); }\ntry\n{\n    using Lease outer = new Lease(\"outer\"), inner = Fail();\n}\ncatch (Exception error) { Console.WriteLine(error.Message); }\nusing (Lease missing = null) { Console.WriteLine(\"null skipped\"); }\nclass Lease : IDisposable\n{\n    public string Name { get; }\n    public Lease(string name) { Name = name; Console.WriteLine(\"acquire \" + name); }\n    public void Dispose() { Console.WriteLine(\"dispose \" + Name); }\n}\n"}]},
{"id": "constant-patterns", "name": "Constant expressions & switch patterns", "description": "Compile-time primitive constants, nameof, integer masks, and evaluated case labels.", "expectedOutput": "answer\n15\n-2147483648\nmatched\n", "files": [{"uri": "Program.cs", "text": "const int Base = 6 * 7;\nconst int Mask = (1 << 4) - 1;\nconst int Wrapped = unchecked(2147483647 + 1);\nint value = 42;\nswitch (value)\n{\n    case Base: Console.WriteLine(\"answer\"); break;\n    default: Console.WriteLine(\"other\"); break;\n}\nConsole.WriteLine(Mask);\nConsole.WriteLine(Wrapped);\nConsole.WriteLine(value switch { Base => \"matched\", _ => \"other\" });\n"}]},
{"id": "refactor-safe06", "name": "Scope-preserving refactorings", "description": "Ctrl+. offers make-const, conditional returns, expression bodies, and scoped using declarations.", "expectedOutput": "acquire local\n42\ndispose local\nafter\n", "files": [{"uri": "Program.cs", "text": "int Select(int value)\n{\n    if (value > 0) { return 42; }\n    else { return 0; }\n}\nint amount = 7;\nusing (var lease = new Lease(\"local\"))\n{\n    Printer.Print(Select(amount));\n}\nConsole.WriteLine(\"after\");\nclass Lease : IDisposable\n{\n    public string Name { get; }\n    public Lease(string name) { Name = name; Console.WriteLine(\"acquire \" + name); }\n    public void Dispose() { Console.WriteLine(\"dispose \" + Name); }\n}\nclass Printer { public static void Print(int value) { Console.WriteLine(value); } }\n"}]},
{"id": "immutable-schema", "name": "Generated immutable models", "description": "A schema generates a constructor and getter-only auto-properties in the compiler worker.", "expectedOutput": "42\nsensor\n", "files": [{"uri": "Program.cs", "text": "var row = new Reading(42, \"sensor\");\nConsole.WriteLine(row.Value);\nConsole.WriteLine(row.Name);\n"}], "extensions": {"schema": true, "analyzers": true, "additionalFiles": [{"uri": "reading.schema.json", "text": "{\n  \"name\": \"Reading\",\n  \"immutable\": true,\n  \"fields\": [\n    {\n      \"name\": \"Value\",\n      \"type\": \"int\"\n    },\n    {\n      \"name\": \"Name\",\n      \"type\": \"string\"\n    }\n  ]\n}"}]}},
{"id": "unreachable-analyzer", "name": "Analyzer severity configuration", "description": "A syntax-local analyzer identifies statements after unconditional exits; code still compiles with a warning.", "expectedOutput": "42\n", "files": [{"uri": "Program.cs", "text": "int Answer()\n{\n    return 42;\n    Console.WriteLine(\"unreachable\");\n}\nConsole.WriteLine(Answer());\n"}], "extensions": {"analyzers": true, "severities": {"SFAN1005": "warning"}}},
{"id": "reversible-storage", "name": "Storage writes & reversible execution", "description": "Build then debug the DLL in Assembly Explorer to watch array storage and reverse through GC and finally.", "expectedOutput": "42\ncleanup\n", "files": [{"uri": "Program.cs", "text": "var cell = new Cell();\nint[] values = new int[2];\ntry\n{\n    cell.Value = 40;\n    values[0] = cell.Value;\n    GC.Collect();\n    values[1] = values[0] + 2;\n    Console.WriteLine(values[1]);\n}\nfinally { Console.WriteLine(\"cleanup\"); }\nclass Cell { public int Value; }\n"}]},
{"id": "breakpoint-workbench", "name": "Breakpoint workbench", "description": "F9 on the marked loop line, set hit count 2 or condition total >= 3, then continue, step and reverse.", "expectedOutput": "checkpoint 0 = 1\ncheckpoint 1 = 3\ncheckpoint 2 = 6\ncleanup\n6\n", "files": [{"uri": "Program.cs", "text": "// Set F9 on the total assignment; try condition i == 1, hit count 2, or a logpoint.\nint total = 0;\ntry\n{\n    for (int i = 0; i < 3; i++)\n    {\n        total += i + 1;\n        Console.WriteLine(\"checkpoint \" + i + \" = \" + total);\n    }\n}\nfinally { Console.WriteLine(\"cleanup\"); }\nConsole.WriteLine(total);\n"}]},
{"id": "editor-keymaps", "name": "Editor keymap playground", "description": "Choose Settings > Keyboard Profile. Practice Visual Studio chords, Vim text objects/macros, Emacs search, and Sublime occurrences.", "expectedOutput": "42\n", "files": [{"uri": "Program.cs", "text": "// Visual Studio (default): Ctrl+K Ctrl+C comments, Ctrl+K Ctrl+U uncomments.\n// Vim: gg, /answer, ciw, u, Ctrl+r, :%s/answer/result/g, :w.\n// Emacs: Ctrl+a / Ctrl+e, Ctrl+k / Ctrl+y, Ctrl+s incremental search.\n// Sublime: Ctrl+d twice selects both answer occurrences for simultaneous edits.\n// F9 toggles a breakpoint in every profile; F10/F11 step while debugging.\nint answer = 6 * 7;\nConsole.WriteLine(answer);\n"}]},
{"id": "explorer-members", "name": "Explorer folders & members", "description": "Expand each source file to navigate classes and members. Rename, copy, and undo file changes; explore shared menus.", "expectedOutput": "42\n", "files": [{"uri": "Program.cs", "text": "var counter = new Counter(40);\ncounter.Add(2);\nConsole.WriteLine(counter.Value);\n"}, {"uri": "Models/Counter.cs", "text": "partial class Counter\n{\n    public int Value { get; private set; }\n    public Counter(int value) { Value = value; }\n}\n"}, {"uri": "Models/Counter.Operations.cs", "text": "partial class Counter\n{\n    public void Add(int amount) { Value += amount; }\n}\n"}]},
{"id": "debug-exact", "name": "Exact breakpoint locations", "description": "F5 stops at the multiline WriteLine statement, not the following statement. Requested continuation line and executing span stay distinct.", "expectedOutput": "0\n1\n2\n", "files": [{"uri": "Program.cs", "text": "// F5: the requested line is inside a multiline statement.\nfor (int i = 0; i < 3; i++)\n{\n    Console.WriteLine(\n        i\n    );\n}\n"}], "debug": {"breakpoints": {"Program.cs": [{"line": 5}]}, "watches": ["i"]}},
{"id": "debug-callsite", "name": "Caller storage and stack frames", "description": "At the assignment, right-click value in Locals and choose Break on write. Continue stops after assignment at the caller, not at the return in Answers.cs.", "expectedOutput": "42\n", "files": [{"uri": "Program.cs", "text": "class Program\n{\n    static void Main()\n    {\n        int value = 0;\n        value = Answers.Get();\n        Console.WriteLine(value);\n    }\n}\n"}, {"uri": "Answers.cs", "text": "class Answers\n{\n    public static int Get()\n    {\n        return 42;\n    }\n}\n"}], "debug": {"breakpoints": {"Program.cs": [{"line": 6}]}, "watches": ["value"]}},
{"id": "debug-conditions", "name": "Changed conditions and reverse replay", "description": "F5 stops when i/2 changes: i=2 and i=4. Reverse Continue restores the previous retained stop and its encounter count.", "expectedOutput": "0\n1\n2\n3\n4\n5\n", "files": [{"uri": "Program.cs", "text": "// Has changed seeds at i=0 without stopping.\nfor (int i = 0; i < 6; i++)\n{\n    Console.WriteLine(i);\n}\n"}], "debug": {"breakpoints": {"Program.cs": [{"line": 4, "condition": "i / 2", "conditionMode": "whenChanged"}]}, "watches": ["i", "i / 2"]}},
{"id": "debug-function", "name": "Conditional function breakpoints", "description": "F5 stops in MathBox.AddOne(int) only when value >= 2. Select Main to inspect the caller; Show Next Statement returns to the actual executing frame.", "expectedOutput": "1\n2\n3\n", "files": [{"uri": "Program.cs", "text": "class Program\n{\n    static void Main()\n    {\n        for (int i = 0; i < 3; i++)\n        {\n            Console.WriteLine(MathBox.AddOne(i));\n        }\n    }\n}\n"}, {"uri": "MathBox.cs", "text": "class MathBox\n{\n    public static int AddOne(int value)\n    {\n        return value + 1;\n    }\n}\n"}], "debug": {"functionBreakpoints": [{"name": "MathBox.AddOne(int)", "condition": "value >= 2"}], "watches": ["value"]}},
{"id": "debug-exception", "name": "Exception stops and cleanup replay", "description": "Add System.OverflowException \u2192 When thrown in Debugger / Exception Settings. The stop is at checked arithmetic before unwinding; reverse replay preserves the pending fault.", "expectedOutput": "overflow caught\ncleanup\n42\n", "files": [{"uri": "Program.cs", "text": "try\n{\n    int value = 2147483647;\n    value = checked(value + 1);\n}\ncatch (Exception error)\n{\n    Console.WriteLine(\"overflow caught\");\n}\nfinally\n{\n    Console.WriteLine(\"cleanup\");\n}\nConsole.WriteLine(42);\n"}], "debug": {"breakpoints": {"Program.cs": [{"line": 4}]}, "watches": ["value"]}},
{"id": "async-stacks", "name": "Async tasks & await stacks", "description": "Two independent managed tasks suspend and resume. Pause to inspect Threads and Parallel Stacks; these are cooperative contexts, not OS threads.", "expectedOutput": "82\n", "files": [{"uri": "Program.cs", "text": "using System.Threading.Tasks;\nclass Program\n{\n    static async Task<int> Work(int value, int delay)\n    {\n        int answer = value * 2;\n        await Task.Delay(delay);\n        return answer;\n    }\n    static async Task Main()\n    {\n        Task<int> first = Work(20, 800);\n        Task<int> second = Work(21, 300);\n        int left = await first;\n        int right = await second;\n        Console.WriteLine(left + right);\n    }\n}\n"}], "debug": {"breakpoints": {"Program.cs": [{"line": 8}]}, "watches": ["value", "answer"]}},
{"id": "logical-threads", "name": "Cooperative thread stacks", "description": "Thread.Start/Join, logical thread names, shared managed statics, freeze/thaw and independent stacks.", "expectedOutput": "Calculation\n42\n", "files": [{"uri": "Program.cs", "text": "using System.Threading;\nclass Program\n{\n    static int result;\n    static void Worker()\n    {\n        Thread.Sleep(500);\n        result = 42;\n        Console.WriteLine(Thread.CurrentThread.Name);\n    }\n    static void Main()\n    {\n        Thread worker = new Thread(Worker);\n        worker.Name = \"Calculation\";\n        worker.Start();\n        worker.Join();\n        Console.WriteLine(result);\n    }\n}\n"}], "debug": {"breakpoints": {"Program.cs": [{"line": 8}]}, "watches": ["result"]}},
{"id": "hot-reload", "name": "Live method-body changes", "description": "F5 pauses before Calculate. Open Hot Reload, Edit code, change x + 1 to x + 10, Apply & Continue. Managed state is retained.", "expectedOutput": "42\n", "files": [{"uri": "Program.cs", "text": "class Program\n{\n    static int Calculate(int x)\n    {\n        return x + 1;\n    }\n    static void Main()\n    {\n        int value = 41;\n        Console.WriteLine(Calculate(value));\n    }\n}\n"}], "debug": {"breakpoints": {"Program.cs": [{"line": 10}]}, "watches": ["value"]}},
{"id": "set-next", "name": "Set Next Statement", "description": "F5 stops at value = 2. Right-click the final WriteLine and choose Set Next Statement. Skipped assignments are not executed; live values remain unchanged.", "expectedOutput": "3\n", "files": [{"uri": "Program.cs", "text": "int value = 1;\nvalue = 2;\nvalue = 3;\nConsole.WriteLine(value);\n"}], "debug": {"breakpoints": {"Program.cs": [{"line": 2}]}, "watches": ["value"]}},
{"id": "function-evaluation", "name": "Explicit managed function evaluation", "description": "Pause, open Immediate, explicitly enable side effects, then evaluate ledger.Add(2), ledger.Doubled, or new Ledger(10).Add(1). Try rollback mode.", "expectedOutput": "40\n", "files": [{"uri": "Program.cs", "text": "class Ledger\n{\n    public int Value;\n    public Ledger(int value) { Value = value; }\n    public int Add(int amount) { Value += amount; return Value; }\n    public int Doubled { get { return Value * 2; } }\n}\nclass Program\n{\n    static void Main()\n    {\n        var ledger = new Ledger(40);\n        Console.WriteLine(ledger.Value);\n    }\n}\n"}], "debug": {"breakpoints": {"Program.cs": [{"line": 13}]}, "watches": ["ledger.Value"]}},
{"id": "portable-symbols", "name": "Portable PDB source and locals", "description": "Build exports matching embedded/sidecar symbols. Inspect Symbols, or load the DLL in Assembly Explorer and debug verified source independently of the workspace.", "expectedOutput": "42\n", "files": [{"uri": "Program.cs", "text": "class Program\n{\n    static void Main()\n    {\n        int input = 21;\n        int answer = Calculator.Twice(input);\n        Console.WriteLine(answer);\n    }\n}\n"}, {"uri": "Calculator.cs", "text": "class Calculator\n{\n    public static int Twice(int value)\n    {\n        int result = value * 2;\n        return result;\n    }\n}\n"}], "debug": {"breakpoints": {"Program.cs": [{"line": 6}]}, "watches": ["input", "answer"]}},
{"id": "winui-counter", "name": "WinUI counter \u00b7 code first", "description": "Real C# creates HTML controls using the supported WinUI API. Click Increment; Hot Reload can replace the handler without restarting the window.", "expectedOutput": "", "files": [{"uri": "Program.cs", "text": "using Microsoft.UI.Xaml;\nusing Microsoft.UI.Xaml.Controls;\nusing Microsoft.UI.Xaml.Media;\nusing Microsoft.UI;\nclass Program\n{\n    static TextBlock display;\n    static int count;\n    static void Increment(object sender, RoutedEventArgs args)\n    {\n        count++;\n        display.Text = \"Count: \" + count;\n    }\n    static void Main()\n    {\n        Window window = new Window();\n        window.Title = \"SharpForge \u00b7 Code-first WinUI\";\n        StackPanel panel = new StackPanel();\n        panel.Spacing = 16;\n        panel.Padding = new Thickness(24);\n        TextBlock title = new TextBlock();\n        title.Text = \"A live managed application\";\n        title.FontSize = 26;\n        display = new TextBlock();\n        display.Name = \"Counter\";\n        display.Text = \"Count: 0\";\n        display.FontSize = 38;\n        display.Foreground = new SolidColorBrush(Colors.DodgerBlue);\n        Button button = new Button();\n        button.Name = \"IncrementButton\";\n        button.Content = \"Increment\";\n        button.HorizontalAlignment = HorizontalAlignment.Left;\n        button.Click += Increment;\n        panel.Children.Add(title);\n        panel.Children.Add(display);\n        panel.Children.Add(button);\n        window.Content = panel;\n        window.Activate();\n    }\n}\n"}], "ui": true},
{"id": "winui-controls", "name": "WinUI form \u00b7 input and selection", "description": "TextBox, Slider, ComboBox, ToggleSwitch, CheckBox, ProgressBar and Expander use native HTML input. Submit reads the actual managed input state.", "expectedOutput": "", "files": [{"uri": "Program.cs", "text": "using Microsoft.UI.Xaml;\nusing Microsoft.UI.Xaml.Controls;\nclass Program\n{\n    static TextBox name;\n    static Slider level;\n    static ComboBox choice;\n    static TextBlock result;\n    static ProgressBar progress;\n    static void Submit(object sender, RoutedEventArgs args)\n    {\n        result.Text = \"Hello \" + name.Text + \", item \" + choice.SelectedIndex + \", level \" + level.Value;\n        progress.Value = level.Value;\n    }\n    static void Main()\n    {\n        Window window = new Window();\n        window.Title = \"Managed form\";\n        StackPanel form = new StackPanel();\n        form.Padding = new Thickness(24);\n        form.Spacing = 12;\n        name = new TextBox(); name.Name = \"Name\";\n        name.PlaceholderText = \"Your name\"; name.MaxLength = 80;\n        level = new Slider(); level.Name = \"Level\";\n        level.Minimum = 0; level.Maximum = 100; level.Value = 42;\n        choice = new ComboBox(); choice.Name = \"Choice\";\n        choice.Items.Add(\"First\"); choice.Items.Add(\"Second\"); choice.Items.Add(\"Third\"); choice.SelectedIndex = 0;\n        CheckBox remember = new CheckBox(); remember.Content = \"Remember this form\";\n        ToggleSwitch enabled = new ToggleSwitch(); enabled.Header = \"Enable notifications\";\n        Button submit = new Button(); submit.Content = \"Submit\"; submit.Click += Submit;\n        result = new TextBlock(); result.Name = \"Result\"; result.Text = \"Ready\";\n        progress = new ProgressBar(); progress.Value = 42;\n        Expander details = new Expander(); details.Header = \"About this form\";\n        details.Content = new TextBlock() { Text = \"All handlers execute as managed C# in a worker.\" };\n        form.Children.Add(name); form.Children.Add(choice); form.Children.Add(level);\n        form.Children.Add(remember); form.Children.Add(enabled); form.Children.Add(submit);\n        form.Children.Add(result); form.Children.Add(progress); form.Children.Add(details);\n        window.Content = form; window.Activate();\n    }\n}\n"}], "ui": true},
{"id": "winui-graphics", "name": "WinUI graphics \u00b7 WebGPU / Canvas / DOM", "description": "Retained Canvas shapes and an explicit DrawingSurface extension. Choose a renderer in the WinUI tool. HTML text and input stay accessible.", "expectedOutput": "", "files": [{"uri": "Program.cs", "text": "using Microsoft.UI.Xaml;\nusing Microsoft.UI.Xaml.Controls;\nusing Microsoft.UI.Xaml.Media;\nusing Microsoft.UI.Xaml.Shapes;\nusing Microsoft.UI;\nclass Program\n{\n    static void Main()\n    {\n        StackPanel panel = new StackPanel(); panel.Spacing = 18; panel.Padding = new Thickness(24);\n        panel.Children.Add(new TextBlock() { Text = \"One scene \u00b7 three rendering backends\", FontSize = 24 });\n        Canvas canvas = new Canvas(); canvas.Height = 180; canvas.Width = 560;\n        Rectangle rectangle = new Rectangle(); rectangle.Width = 180; rectangle.Height = 110;\n        rectangle.Fill = new SolidColorBrush(Colors.DodgerBlue); Canvas.SetLeft(rectangle, 20); Canvas.SetTop(rectangle, 25);\n        Ellipse ellipse = new Ellipse(); ellipse.Width = 130; ellipse.Height = 130;\n        ellipse.Fill = new SolidColorBrush(Colors.Orange); Canvas.SetLeft(ellipse, 230); Canvas.SetTop(ellipse, 15);\n        Line line = new Line(); line.X1 = 380; line.Y1 = 140; line.X2 = 520; line.Y2 = 25;\n        line.Stroke = new SolidColorBrush(Colors.CornflowerBlue); line.StrokeThickness = 5;\n        canvas.Children.Add(rectangle); canvas.Children.Add(ellipse); canvas.Children.Add(line);\n        SharpForge.UI.DrawingSurface drawing = new SharpForge.UI.DrawingSurface(); drawing.Width = 560; drawing.Height = 100;\n        for (int i = 0; i < 8; i++)\n            drawing.FillRectangle(i * 65 + 10, 80 - i * 8, 48, i * 8 + 12, Colors.CornflowerBlue);\n        panel.Children.Add(canvas); panel.Children.Add(drawing);\n        Window window = new Window(); window.Title = \"WebGPU with fallbacks\"; window.Content = panel; window.Activate();\n    }\n}\n"}], "ui": true},
{"id": "winui-async", "name": "WinUI async callback \u00b7 debugger", "description": "Click Calculate. The C# handler changes UI, awaits a real timer, then updates the same controls. Set a breakpoint after await and inspect its logical stack.", "expectedOutput": "", "files": [{"uri": "Program.cs", "text": "using Microsoft.UI.Xaml;\nusing Microsoft.UI.Xaml.Controls;\nusing System.Threading.Tasks;\nclass Program\n{\n    static Button button;\n    static TextBlock status;\n    static async void Calculate(object sender, RoutedEventArgs args)\n    {\n        button.IsEnabled = false;\n        status.Text = \"Calculating\u2026\";\n        await Task.Delay(700);\n        int answer = 6 * 7;\n        status.Text = \"Answer: \" + answer;\n        button.IsEnabled = true;\n    }\n    static void Main()\n    {\n        StackPanel panel = new StackPanel(); panel.Spacing = 16; panel.Padding = new Thickness(24);\n        status = new TextBlock(); status.Name = \"Status\"; status.Text = \"Ready\"; status.FontSize = 26;\n        button = new Button(); button.Name = \"Calculate\"; button.Content = \"Calculate\";\n        button.Click += Calculate;\n        panel.Children.Add(status); panel.Children.Add(button);\n        Window window = new Window(); window.Title = \"Async managed UI\"; window.Content = panel; window.Activate();\n    }\n}\n"}], "ui": true}
,...designerSamples,...release13Samples,...release14Samples
];
