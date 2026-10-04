/**
 * Large synthetic C# programs for compile-time measurements: `units` copies of a block of declarations that mixes
 * classes, generics, lambdas, async methods, patterns and plain arithmetic, plus a `Main` that uses them.
 * The text is deterministic; one unit is about 80 lines (`full`) or 50 lines (`executable`).
 *
 * `full` adds inheritance and type patterns: valid C# that the analysis binds completely but the runtime profile
 * does not execute. `executable` leaves those out, so the compilation also generates an image.
 */

const shapes = index => `
abstract class Shape${index}
{
    public abstract double Area();
    public abstract string Name { get; }
}

class Circle${index} : Shape${index}
{
    private readonly double radius;
    public Circle${index}(double radius) { this.radius = radius; }
    public override double Area() { return 3.14159 * radius * radius; }
    public override string Name => "circle${index}";
}

class Square${index} : Shape${index}
{
    private readonly double side;
    public Square${index}(double side) { this.side = side; }
    public override double Area() { return side * side; }
    public override string Name => "square${index}";
}

static class Shapes${index}
{
    public static double Total(Shape${index}[] shapes)
    {
        double total = 0;
        foreach (var shape in shapes)
        {
            if (shape is Circle${index} circle) total += circle.Area();
            else total += shape.Area() * 0.5;
        }
        return total;
    }

    public static string Describe(object item)
    {
        return item switch
        {
            int n when n > 10 => "large " + n,
            int n => "small " + n,
            string s => "text " + s.Length,
            Shape${index} shape => shape.Name + " " + shape.Area(),
            null => "nothing",
            _ => "other",
        };
    }
}
`;

const unit = index => `
class Box${index}<T>
{
    private T value;
    public Box${index}(T value) { this.value = value; }
    public T Value => value;
    public Box${index}<U> Map<U>(Func<T, U> map) { return new Box${index}<U>(map(value)); }
    public bool Matches(Func<T, bool> test) { return test(value); }
}

static class Module${index}
{
    public static int Sum(int[] values)
    {
        int total = 0;
        for (int i = 0; i < values.Length; i++)
        {
            if (values[i] % 2 == 0) total += values[i];
            else total -= values[i] / 2;
        }
        return total;
    }

    public static string Describe(int item)
    {
        return item switch
        {
            0 => "zero",
            1 => "one",
            _ => "many " + item,
        };
    }

    public static async Task<int> ComputeAsync(int seed)
    {
        await Task.Yield();
        var box = new Box${index}<int>(seed).Map(x => x * 2).Map(x => x + ${index});
        Func<int, int> twice = x => x * 2;
        int result = twice(box.Value);
        return box.Matches(x => x > 0) ? result : -result;
    }
}
`;

/** The program text for `units` units; `full` adds the inheritance and type-pattern declarations to every unit. */
export function syntheticProgram(units, { full = true } = {}) {
  const calls = Array.from(
    { length: units },
    (_, index) =>
      `        total += Module${index}.Sum(new int[] { 1, 2, 3, ${index} });\n` +
      `        text = Module${index}.Describe(total);\n` +
      `        total += await Module${index}.ComputeAsync(${index});\n`,
  ).join('');
  return (
    'using System;\nusing System.Threading.Tasks;\n' +
    Array.from({ length: units }, (_, index) => unit(index) + (full ? shapes(index) : '')).join('') +
    `\nclass Program\n{\n    static async Task Main()\n    {\n        int total = 0;\n        string text = "";\n${calls}` +
    '        Console.WriteLine(total + text.Length);\n    }\n}\n'
  );
}

/** The files of the existing `npm run bench` corpus: `files` classes of `statements` additions each, and a Main. */
export function generatedCorpus(files, statements) {
  const body = Array.from({ length: statements }, (_, index) => `  value += ${index % 97};`).join('\n');
  return [
    ...Array.from({ length: files }, (_, index) => ({
      uri: `Generated${index}.cs`,
      text: `class Generated${index}\n{\n public static int Calculate(int input)\n {\n  int value=input;\n${body}\n  return value;\n }\n}\n`,
    })),
    { uri: 'Program.cs', text: 'Console.WriteLine(Generated0.Calculate(1));\n' },
  ];
}
