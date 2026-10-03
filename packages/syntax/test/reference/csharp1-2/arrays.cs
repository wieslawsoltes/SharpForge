using System.Collections.Generic;
class Arrays
{
    int[] a = new int[5];
    int[,] b = new int[2, 3];
    int[][] c = new int[2][];
    int[,,][][,] d = new int[1, 2, 3][][,];
    int[] e = { 1, 2, 3 };
    int[,] f = { { 1, 2 }, { 3, 4 } };
    int[][] g = { new[] { 1 }, new int[] { 2, 3 }, new int[0] };
    string[] h = new string[] { "a", "b", };
    int[,] i = new int[2, 2] { { 1, 2 }, { 3, 4 } };
    int[][,] j = new int[][,] { new int[,] { { 1 } } };
    int[,,] k = { { { 1 }, { 2 } }, { { 3 }, { 4 } } };
    void M(int n)
    {
        var x = b[0, 1] + c[1][0] + d[0, 0, 0][1][2, 3];
        b[n, n + 1] = a[a[0]];
        var y = new int[n * 2, n > 0 ? 1 : 2];
        var z = new int[] { }.Length + new int[3].Length;
        int[] local = { }, other = { n, };
        object o = new object[] { 1, "two", null, new int[] { 3 } };
        var jag = new int[n][][];
        var nul = new int?[2]; var gen = new List<int>[3]; var test = new int[2] is int[];
        long[,] big = new long[2L, 3u];
        var first = new[] { 1, 2 }[0] + new int[,] { { 1 } }[0, 0];
        a[0]++; --b[1, 1]; c[0] = new int[] { 1 }; c[0][0] += 2;
        string[][] names = new string[2][] { new string[] { "a" }, null };
    }
}
