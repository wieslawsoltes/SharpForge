using System;
[assembly: CLSCompliant(false)]
[assembly: Acme.Marks.Note("assembly", 0)]
namespace Acme.Marks {
  public enum Level : short { Low = 1, High = 2 }
  [AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
  public sealed class NoteAttribute : Attribute {
    public NoteAttribute(string text, int rank) { }
    public NoteAttribute(Level level) { }
    public NoteAttribute(Type type, params string[] tags) { }
    public NoteAttribute(object boxed) { }
    public string Detail { get; set; }
    public int Weight;
    public Level[] Levels { get; set; }
  }
  [Serializable]
  [Note("type", 1, Detail = "named", Weight = 7)]
  [Note(Level.High)]
  public class Marked {
    [Note(typeof(Marked), "a", "b")]
    [Obsolete("use Other", false)]
    public int Field;
    [Note("property", 2, Levels = new[] { Level.Low, Level.High })]
    public string Text { get; set; }
    [Note(42)]
    [Note("text")]
    public event Action Changed;
    [Note("method", 3)]
    public void Run([Note("parameter", 4)] int value, [Note(null, 5)] params int[] rest) { }
    [Note(typeof(int[]))]
    public Marked() { }
    public int this[[Note("index", 6)] int index] { get { return index; } }
  }
  [Flags]
  public enum Options { None = 0, [Note("member", 8)] First = 1 }
  [Note(Level.Low)]
  public struct Value { }
  [Note("interface", 9)]
  public interface IMarked { [Note("slot", 10)] void M(); }
  [Note("delegate", 11)]
  public delegate void Handler();
}
