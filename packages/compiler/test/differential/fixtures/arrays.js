/**
 * Differential fixtures for SF-A02-T45 (C# 1 arrays): jagged arrays, rank-n arrays lowered onto one flat array,
 * the System.Array members every array has, and the creation, initializer, indexing and conversion rules.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('array-ranks', [
    out(
      'jagged-arrays',
      cs`
    using System;
    class Program
    {
        static int[][] Triangle(int n)
        {
            int[][] rows = new int[n][];
            for (int i = 0; i < n; i++)
            {
                rows[i] = new int[i + 1];
                for (int j = 0; j <= i; j++) rows[i][j] = i * 10 + j;
            }
            return rows;
        }
        static void Main()
        {
            int[][] jag = Triangle(3);
            Console.WriteLine(jag[2][1] + jag.Length + jag[2].Length);
            int[][] jag2 = { new int[] { 9 }, new int[] { 8, 7 } };
            Console.WriteLine(jag2[1][0]);
            jag2[1][0]++;
            jag2[0] = jag2[1];
            Console.WriteLine(jag2[0][0]);
            string[][] words = new string[][] { new string[] { "a", "b" }, new string[0] };
            Console.WriteLine(words[0][1] + words[1].Length);
            int total = 0;
            foreach (int[] row in jag) foreach (int v in row) total += v;
            Console.WriteLine(total);
            int[][][] deep = new int[2][][];
            deep[1] = new int[][] { new int[] { 4 } };
            Console.WriteLine(deep[1][0][0]);
            Console.WriteLine(deep[0] == null);
        }
    }
    `,
    ),
    out(
      'multi-dimensional-arrays',
      cs`
    using System;
    class Program
    {
        static int Sum(int[,] m)
        {
            int s = 0;
            for (int i = 0; i < m.GetLength(0); i++)
                for (int j = 0; j < m.GetLength(1); j++) s += m[i, j];
            return s;
        }
        static void Main()
        {
            int[,] grid = new int[2, 3];
            grid[1, 2] = 7;
            grid[0, 1] += 2;
            grid[0, 0]++;
            Console.WriteLine(grid[1, 2] + grid[0, 0] + grid[0, 1]);
            Console.WriteLine(grid.Length);
            Console.WriteLine(grid.Rank);
            Console.WriteLine(grid.GetLength(0) + " " + grid.GetLength(1));
            Console.WriteLine(Sum(grid));
            int[,] init = { { 1, 2 }, { 3, 4 }, { 5, 6 } };
            int sum = 0;
            foreach (int v in init) sum = sum * 10 + v;
            Console.WriteLine(sum);
            string[,] names = new string[2, 2] { { "a", "b" }, { "c", "d" } };
            Console.WriteLine(names[1, 0] + names[0, 1]);
            int[,,] cube = new int[2, 3, 4];
            cube[1, 2, 3] = 5;
            Console.WriteLine(cube[1, 2, 3] + cube.Length + cube.GetLength(2));
            int[][,] mix = new int[2][,];
            mix[0] = new int[1, 1];
            Console.WriteLine(mix[0][0, 0]);
            int[] one = new int[3] { 1, 2, 3 };
            Console.WriteLine(one.Rank + one.GetLength(0));
            double[,] real = new double[1, 2];
            real[0, 1] = 1.5;
            Console.WriteLine(real[0, 1]);
            bool[,] flags = new bool[2, 2];
            Console.WriteLine(flags[1, 1]);
            try { grid[2, 0] = 1; } catch (Exception) { Console.WriteLine("range"); }
            try { Console.WriteLine(grid[0, 3]); } catch (Exception) { Console.WriteLine("range"); }
            try { Console.WriteLine(grid[0, -1]); } catch (Exception) { Console.WriteLine("range"); }
        }
    }
    `,
    ),
    out(
      'multi-dimensional-arrays-in-members',
      cs`
    using System;
    class Board
    {
        static int[,] weights = { { 1, 2, 3 }, { 4, 5, 6 } };
        string[,] cells = new string[2, 2];
        public int[,] Counts;
        public Board() { Counts = new int[Size(), Size() + 1]; }
        static int calls;
        static int Size() { calls++; Console.WriteLine("size " + calls); return 2; }
        static int Trace(string label, int value) { Console.WriteLine(label); return value; }
        public string this[int row, int column]
        {
            get { return cells[row, column]; }
            set { cells[row, column] = value; }
        }
        public static int Weight(int row, int column) { return weights[row, column]; }
        public static int[,] Identity(int n)
        {
            int[,] m = new int[n, n];
            for (int i = 0; i < n; i++) m[i, i] = 1;
            return m;
        }
        public static void Run()
        {
            Board b = new Board();
            b[0, 1] = "x";
            b[1, 0] = "y";
            Console.WriteLine(b[0, 1] + b[1, 0] + (b[0, 0] == null));
            Console.WriteLine(Weight(1, 2) + Weight(0, 0));
            Console.WriteLine(b.Counts.GetLength(0) + "x" + b.Counts.GetLength(1) + " " + b.Counts.GetUpperBound(1) + " " + b.Counts.GetLowerBound(0));
            int[,] grid = new int[2, 2];
            grid[Trace("row", 1), Trace("column", 0)] = Trace("value", 7);
            grid[Trace("r", 1), Trace("c", 0)] += Trace("v", 3);
            Console.WriteLine(grid[1, 0]);
            Console.WriteLine(grid[1, 0]++ + " " + ++grid[1, 0] + " " + grid[1, 0]--);
            grid[0, 1] -= 4;
            grid[0, 1] *= 3;
            Console.WriteLine(grid[0, 1]);
            int[,] id = Identity(3);
            int trace = 0;
            foreach (int v in id) { trace = trace * 2 + v; if (trace > 200) break; }
            Console.WriteLine(trace);
            Func<int, int> diagonal = i => id[i, i] + grid[1, 0];
            Console.WriteLine(diagonal(2));
            int[,] none = null;
            Console.WriteLine(none == null);
            try { Console.WriteLine(none[0, 0]); } catch (Exception) { Console.WriteLine("null"); }
            int[,] empty = new int[0, 5];
            Console.WriteLine(empty.Length + " " + empty.GetLength(1));
            int[,] jaggedRows = { { 1 }, { 2 }, { 3 } };
            int[][,] list = { jaggedRows, id };
            Console.WriteLine(list[0][2, 0] + list[1][2, 2] + list.Length);
            int[,][] cellsOfArrays = new int[1, 2][];
            cellsOfArrays[0, 1] = new int[] { 4, 5 };
            Console.WriteLine(cellsOfArrays[0, 1][1]);
            double[,] real = { { 0.5, 1.5 } };
            real[0, 0] += real[0, 1];
            Console.WriteLine(real[0, 0]);
            var inferred = new[,] { { "a" }, { "b" } };
            Console.WriteLine(inferred[1, 0] + inferred.Rank);
        }
    }
    class Program
    {
        static void Main() { Board.Run(); }
    }
    `,
    ),
    out(
      'length-rank-and-bounds',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            int[] one = new int[3] { 1, 2, 3 };
            Console.WriteLine(one.Rank);
            Console.WriteLine(one.GetLength(0));
            Console.WriteLine(one.GetLowerBound(0) + " " + one.GetUpperBound(0));
            try { Console.WriteLine(one[3]); } catch (Exception) { Console.WriteLine("range"); }
            int[][] jag = new int[2][];
            Console.WriteLine(jag.Rank + " " + jag.GetLength(0));
            int[,,] cube = new int[2, 3, 4];
            Console.WriteLine(cube.Rank + " " + cube.Length);
            Console.WriteLine(cube.GetLength(0) + " " + cube.GetLength(1) + " " + cube.GetLength(2));
            Console.WriteLine(cube.GetUpperBound(2) + " " + cube.GetLowerBound(1));
            string[] empty = new string[0];
            Console.WriteLine(empty.Length + " " + empty.GetUpperBound(0));
        }
    }
    `,
    ),
    diag(
      'creation-indexing-and-conversion-rules',
      cs`
    class Animal { }
    class Dog : Animal { }
    class Program
    {
        static void Main()
        {
            int[,] a = { { 1, 2 }, { 3 } };
            int[,] b = new int[2, 2] { { 1, 2 }, { 3, 4 }, { 5, 6 } };
            int[,] c = { 1, 2 };
            int[] d = { { 1 }, { 2 } };
            int n = 2;
            int[,] e = new int[n, 2] { { 1, 2 }, { 3, 4 } };
            int[] sized = new int[2] { 1, 2, 3 };
            int[,] f = new int[2];
            int[,] g = new int[2, 2];
            int h = g[1];
            int i = g[1, 1, 1];
            int[] j = new int[-1];
            int[,] k = new int[2, -3];
            int[] m = new int[];
            Dog[] dogs = new Animal[1];
            Animal[] animals = new Dog[1];
            int[] ints = new long[1];
            object[] boxes = new int[1];
            long[] longs = new int[1];
            int[,] two = new int[2][];
            var o = new[] { 1, "a" };
            var p = new[,] { { 1, 2 }, { 3, 4 } };
            var ragged = new[,] { { 1, 2 }, { 3 } };
            var flat = new[,] { 1, 2 };
            string q = g["x", 1];
            int r = g[1.5, 1];
            Dog[] viaCast = (Dog[])animals;
            int[] bad = (int[])longs;
            int rank = p.Rank + g.GetLength(0);
        }
    }
    `,
    ),
  ]),
];
