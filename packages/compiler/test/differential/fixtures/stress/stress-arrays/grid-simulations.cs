using System;
using System.Collections.Generic;
using System.Text;

public struct Tile
{
    public char Kind;
    public int Visits;
}

public static class Grids
{
    public static bool[,] ParseLife(params string[] rows)
    {
        var cells = new bool[rows.Length, rows[0].Length];
        for (int r = 0; r < rows.Length; r++)
            for (int c = 0; c < rows[r].Length; c++)
                cells[r, c] = rows[r][c] == '#';
        return cells;
    }

    public static bool[,] Step(bool[,] cells)
    {
        int rows = cells.GetLength(0), columns = cells.GetLength(1);
        var next = new bool[rows, columns];
        for (int r = 0; r < rows; r++)
        {
            for (int c = 0; c < columns; c++)
            {
                int neighbours = 0;
                for (int dr = -1; dr <= 1; dr++)
                {
                    int nr = r + dr;
                    if (nr < 0 || nr > cells.GetUpperBound(0)) continue;
                    for (int dc = -1; dc <= 1; dc++)
                    {
                        if (dr == 0 && dc == 0) continue;
                        int nc = c + dc;
                        if (nc < 0) continue;
                        if (nc >= columns) break;
                        if (cells[nr, nc]) neighbours++;
                    }
                }
                next[r, c] = neighbours == 3 || (cells[r, c] && neighbours == 2);
            }
        }
        return next;
    }

    public static string Show(bool[,] cells)
    {
        var text = new StringBuilder();
        int column = 0;
        foreach (bool alive in cells)
        {
            text.Append(alive ? '#' : '.');
            if (++column % cells.GetLength(1) == 0 && column < cells.Length) text.Append('/');
        }
        return text.ToString();
    }

    public static int Flood(Tile[,] map, int row, int column, char paint)
    {
        char target = map[row, column].Kind;
        if (target == paint) return 0;
        var pending = new Stack<(int Row, int Column)>();
        pending.Push((row, column));
        int painted = 0;
        while (pending.Count > 0)
        {
            var (r, c) = pending.Pop();
            if (r < 0 || c < 0 || r >= map.GetLength(0) || c >= map.GetLength(1)) continue;
            map[r, c].Visits++;
            if (map[r, c].Kind != target) continue;
            map[r, c].Kind = paint;
            painted++;
            pending.Push((r + 1, c));
            pending.Push((r - 1, c));
            pending.Push((r, c + 1));
            pending.Push((r, c - 1));
        }
        return painted;
    }

    public static List<T> Spiral<T>(T[,] matrix)
    {
        var result = new List<T>(matrix.Length);
        int top = 0, left = 0, bottom = matrix.GetUpperBound(0), right = matrix.GetUpperBound(1);
        while (true)
        {
            for (int c = left; c <= right; c++) result.Add(matrix[top, c]);
            if (++top > bottom) break;
            for (int r = top; r <= bottom; r++) result.Add(matrix[r, right]);
            if (--right < left) break;
            for (int c = right; c >= left; c--) result.Add(matrix[bottom, c]);
            if (--bottom < top) break;
            for (int r = bottom; r >= top; r--) result.Add(matrix[r, left]);
            if (++left > right) break;
        }
        return result;
    }

    public static T[,] RotateRight<T>(T[,] matrix)
    {
        int rows = matrix.GetLength(0), columns = matrix.GetLength(1);
        var rotated = new T[columns, rows];
        for (int r = 0; r < rows; r++)
            for (int c = 0; c < columns; c++)
                rotated[c, rows - 1 - r] = matrix[r, c];
        return rotated;
    }

    public static (int Layer, int Row, int Column) FindFirst(int[,,] cube, Predicate<int> match)
    {
        int layer = 0, row = 0, column = 0;
        for (layer = 0; layer < cube.GetLength(0); layer++)
            for (row = 0; row < cube.GetLength(1); row++)
                for (column = 0; column < cube.GetLength(2); column++)
                    if (match(cube[layer, row, column])) goto found;
        return (-1, -1, -1);
    found:
        return (layer, row, column);
    }
}

public static class Program
{
    public static void Main()
    {
        var life = Grids.ParseLife(".....", "..#..", "...#.", ".###.", ".....", ".....");
        Console.WriteLine($"rank {life.Rank} length {life.Length} {life.GetLength(0)}x{life.GetLength(1)} bounds {life.GetLowerBound(0)}..{life.GetUpperBound(0)},{life.GetUpperBound(1)} long {life.GetLongLength(1)}");
        for (int generation = 0; generation <= 4; generation++)
        {
            Console.WriteLine($"gen {generation}: {Grids.Show(life)}");
            life = Grids.Step(life);
        }
        var blinker = Grids.ParseLife("...", "###", "...");
        Console.WriteLine("blinker " + Grids.Show(blinker) + " " + blinker.Length + " " + (blinker[1, 0] & blinker[1, 2] & !blinker[0, 1]));
        Console.WriteLine(Grids.Show(Grids.Step(blinker)) + " " + (Grids.Show(Grids.Step(Grids.Step(blinker))) == Grids.Show(blinker)));

        string[] plan = { "~~~..##", "~~.#..#", "....#..", ".##.~~~", ".#..~~." };
        var map = new Tile[plan.Length, plan[0].Length];
        for (int r = 0; r < plan.Length; r++)
            for (int c = 0; c < plan[r].Length; c++)
                map[r, c].Kind = plan[r][c];
        int regions = 0;
        var sizes = new List<string>();
        for (int r = 0; r < map.GetLength(0); r++)
        {
            for (int c = 0; c < map.GetLength(1); c++)
            {
                char kind = map[r, c].Kind;
                if (kind is >= 'A' and <= 'Z') continue;
                sizes.Add(kind + "=" + Grids.Flood(map, r, c, (char)('A' + regions++)));
            }
        }
        var painted = new StringBuilder();
        int visits = 0, index = 0;
        foreach (Tile tile in map)
        {
            painted.Append(tile.Kind);
            visits += tile.Visits;
            if (++index % map.GetLength(1) == 0) painted.Append(' ');
        }
        Console.WriteLine($"{regions} regions: {string.Join(" ", sizes)}");
        Console.WriteLine(painted.ToString() + "visits " + visits + " corner " + map[4, 6].Visits + " refill " + Grids.Flood(map, 0, 0, 'A'));

        int[,] matrix = { { 1, 2, 3, 4 }, { 5, 6, 7, 8 }, { 9, 10, 11, 12 } };
        var letters = new[,] { { "a", "b" }, { "c", "d" }, { "e", "f" } };
        object[,] objects = letters;
        Console.WriteLine(string.Join(",", Grids.Spiral(matrix)) + " | " + string.Join("", Grids.Spiral(letters)) + " | " + string.Join(",", Grids.Spiral(new int[1, 3] { { 7, 8, 9 } })) + " | " + string.Join(",", Grids.Spiral(new[,] { { 1 }, { 2 }, { 3 } })) + " | " + Grids.Spiral(new int[0, 0]).Count);
        var rotated = Grids.RotateRight(matrix);
        Console.WriteLine($"{rotated.GetLength(0)}x{rotated.GetLength(1)} {string.Join(",", Grids.Spiral(rotated))} {rotated[0, 0]}{rotated[3, 2]} {objects[2, 1]} {objects.Rank} {ReferenceEquals(objects, letters)} {matrix is { Length: 12, Rank: 2 }}");

        var cube = new int[2, 3, 4];
        for (int i = 0; i < cube.GetLength(0); i++)
            for (int j = 0; j < cube.GetLength(1); j++)
                for (int k = 0; k < cube.GetLength(2); k++)
                    cube[i, j, k] = i * 100 + j * 10 + k;
        var order = new List<int>();
        foreach (int value in cube) if (value % 11 == 0 || value > 120) order.Add(value);
        int[,,] small = { { { 1, 2 }, { 3, 4 } }, { { 5, 6 }, { 7, 8 } } };
        var copy = (int[,,])small.Clone();
        copy[1, 1, 1] = 80;
        small[0, 0, 0]++;
        Console.WriteLine($"{cube.Rank} {cube.Length} {cube.GetUpperBound(2)} {string.Join(",", order)} {small[1, 1, 1]}{copy[1, 1, 1]}{copy[0, 0, 0]}{small[0, 0, 0]}");
        Console.WriteLine(Grids.FindFirst(cube, v => v > 111) + " " + Grids.FindFirst(cube, v => v % 7 == 6) + " " + Grids.FindFirst(cube, v => v < 0) + " " + Grids.FindFirst(small, v => v * v > 30));

        int layerSum = 0, skipped = 0;
        for (int i = 0; i < cube.GetLength(0); i++)
        {
            for (int j = 0; j < cube.GetLength(1); j++)
            {
                if (j == 1) { skipped++; continue; }
                for (int k = 0; k < cube.GetLength(2); k++)
                {
                    if (k == 3) break;
                    layerSum += cube[i, j, k];
                }
            }
            if (layerSum > 60) break;
        }
        Array.Clear(cube);
        Console.WriteLine($"{layerSum} {skipped} {Grids.FindFirst(cube, v => v != 0).Layer} {cube[1, 2, 3]}");
    }
}
