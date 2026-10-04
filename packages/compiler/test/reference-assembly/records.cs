namespace Sample
{
  public record Point(int X, int Y);
  public record Named(string Name, int X, int Y) : Point(X, Y)
  {
    public string Tag { get; init; }
  }
  public sealed record Sealed(int A);
  public abstract record Shape(string Kind);
  public record struct Vector(int Dx, int Dy);
  public readonly record struct Money(long Amount, string Currency);
  public record Box<T>(T Value);
  public class Account
  {
    public required string Owner { get; init; }
    public required int Balance;
    public int Level { get; init; }
    public Account() { }
    [System.Diagnostics.CodeAnalysis.SetsRequiredMembers]
    public Account(string owner) { Owner = owner; }
  }
}
