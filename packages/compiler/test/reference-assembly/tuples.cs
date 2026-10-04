namespace Sample
{
  public class Tuples
  {
    public (int Count, string Label) Pair;
    public (int, int) Plain;
    public (int a1, int a2, int a3, int a4, int a5, int a6, int a7, int a8, int a9) Wide;
    public (string First, (int X, int Y) Where)[] Names { get; set; }
    public System.Collections.Generic.List<(int Key, string)> Listed;
    public static (int Sum, int) Compute((long left, long right) input, (int, int) plain) { return (1, 2); }
    public (int, (string Inner, int)) Nested() { return (1, ("a", 2)); }
    public (int, int) Unnamed() { return (1, 2); }
  }
}
