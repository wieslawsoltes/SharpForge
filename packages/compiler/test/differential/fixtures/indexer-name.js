/**
 * `[IndexerName]` (SF-A02-T10.2): the attribute gives an indexer its metadata name. The name is the one the accessors
 * (`get_Cell`, `set_Cell`), member-name conflicts and `nameof`-free reflection see; indexing itself does not change.
 */
import { cs, out, diag, feature } from './kit.js';

const list = [
  out(
    'renamed-indexer-runs',
    cs`
    using System;
    using System.Runtime.CompilerServices;
    class Grid {
      int[] data = new int[4];
      [IndexerName("Cell")]
      public int this[int i] { get { return data[i]; } set { data[i] = value; } }
      [IndexerName("Cell")]
      public int this[int row, int column] { get { return data[row * 2 + column]; } set { data[row * 2 + column] = value; } }
      // 'Item' is free again: the indexers are named Cell.
      public int Item { get { return 42; } }
      public int get_Item(int i) { return -i; }
    }
    class Program {
      static void Main() {
        var g = new Grid();
        g[1] = 5;
        g[1, 1] = 7;
        g[0] += 2;
        Console.WriteLine(g[1]);
        Console.WriteLine(g[1, 1]);
        Console.WriteLine(g[0]);
        Console.WriteLine(g.Item);
        Console.WriteLine(g.get_Item(3));
      }
    }
    `,
  ),
  out(
    'constant-name',
    cs`
    using System;
    using System.Runtime.CompilerServices;
    static class Names { public const string Row = "Ro" + "w"; }
    class Table {
      [IndexerNameAttribute(Names.Row)]
      public string this[int i] { get { return "r" + i; } }
      public string Item(int i) { return "item" + i; }
      public string get_Item(int i) { return "get" + i; }
    }
    class Keyword {
      [IndexerName("class")]
      public int this[int i] { get { return i * 2; } }
    }
    class Program {
      static void Main() {
        var table = new Table();
        Console.WriteLine(table[3]);
        Console.WriteLine(table.Item(4));
        Console.WriteLine(table.get_Item(5));
        Console.WriteLine(new Keyword()[21]);
      }
    }
    `,
  ),
  // Runs on .NET; here an indexer read through an interface value needs interface dispatch (SF2200).
  out(
    'interface-indexer-names',
    cs`
    using System;
    using System.Runtime.CompilerServices;
    interface IRow {
      [IndexerName(Names.Row)]
      string this[int i] { get; }
    }
    static class Names { public const string Row = "Ro" + "w"; }
    class Table : IRow {
      [IndexerNameAttribute("Entry")]
      public string this[int i] { get { return "r" + i; } }
    }
    class Program {
      static void Main() {
        IRow row = new Table();
        Console.WriteLine(row[2]);
        Console.WriteLine(new Table()[3]);
      }
    }
    `,
  ),
  diag(
    'cs0668-different-names',
    cs`
    using System.Runtime.CompilerServices;
    class A {
      [IndexerName("First")]
      public int this[int i] { get { return i; } }
      [IndexerName("Second")]
      public int this[string s] { get { return 0; } }
      public int this[long l] { get { return 1; } }
    }
    class B {
      public int this[int i] { get { return i; } }
      [IndexerName("Item")]
      public int this[string s] { get { return 0; } }
    }
    `,
  ),
  diag(
    'cs0102-name-conflicts',
    cs`
    using System.Runtime.CompilerServices;
    class A {
      [IndexerName("Cell")]
      public int this[int i] { get { return i; } }
      public int Cell;
    }
    class B {
      [IndexerName("Cell")]
      public int this[int i] { get { return i; } set { } }
      public int get_Cell(int i) { return i; }
      public void set_Cell(int i, int value) { }
      public int get_Item(int i) { return i; }
    }
    class C {
      public int this[int i] { get { return i; } }
      public int Item;
      public int get_Item(int i) { return i; }
    }
    class D {
      [IndexerName("D")]
      public int this[int i] { get { return i; } }
    }
    `,
  ),
  diag(
    'cs0415-cs0633-invalid-uses',
    cs`
    using System.Runtime.CompilerServices;
    interface I { int this[int i] { get; } }
    class A : I {
      [IndexerName("Other")]
      int I.this[int i] { get { return i; } }
    }
    class B {
      [IndexerName("Name")]
      public int P { get { return 1; } }
      [IndexerName("Name")]
      public int F;
      [IndexerName("Name")]
      public void M() { }
    }
    class C {
      [IndexerName("not valid")]
      public int this[int i] { get { return i; } }
    }
    class D {
      [IndexerName("")]
      public int this[int i] { get { return i; } }
    }
    class E {
      [IndexerName(null)]
      public int this[int i] { get { return i; } }
    }
    class F {
      [IndexerName("class")]
      public int this[int i] { get { return i; } }
    }
    class G {
      [IndexerName("@class")]
      public int this[int i] { get { return i; } }
    }
    `,
  ),
  diag(
    'cs0571-accessor-by-name',
    cs`
    using System.Runtime.CompilerServices;
    class A {
      [IndexerName("Cell")]
      public int this[int i] { get { return i; } set { } }
      void Use() {
        int a = get_Cell(1);
        this.set_Cell(1, 2);
        int b = get_Item(1);
      }
    }
    `,
  ),
  diag(
    'override-keeps-base-name',
    cs`
    using System.Runtime.CompilerServices;
    class Base {
      [IndexerName("Cell")]
      public virtual int this[int i] { get { return i; } }
    }
    class Derived : Base {
      public override int this[int i] { get { return i + 1; } }
      public int Cell;
      public int Item;
    }
    class Other : Base {
      [IndexerName("Renamed")]
      public override int this[int i] { get { return i + 1; } }
    }
    `,
  ),
];

export const fixtures = feature('indexer-name', list);
