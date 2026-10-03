class Locals
{
    void M()
    {
        int a = 1, b, c = a + 1;
        const int k = 2, m = k * 3;
        const string s = "x";
        string t = "a", u = null, v;
        int[] arr = { 1 }, arr2 = new int[2];
        System.Collections.Generic.List<int> list = null, list2;
        for (int i = 0, j = 10; i < j; i++, j--) { }
        for (a = 0, b = 1; a < b; a++, b--, c += 2) ;
        for (; ; ) break;
        for (int i = 0; ; ) break;
        for (; a < 3; ) a++;
        for (var e = list.GetEnumerator(); e.MoveNext(); ) { }
        for (M(), M(); ; M(), a++) break;
        int x = (a = 1), y = b = 2;
        var w = 1;
        const double pi = 3.14, tau = pi * 2, e2 = 2.71;
        long big = 1L, bigger = big << 32;
        object o1 = null, o2 = new object(), o3 = o1 ?? o2;
    }
}
