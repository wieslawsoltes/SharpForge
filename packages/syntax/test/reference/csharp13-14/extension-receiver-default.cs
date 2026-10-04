static class E
{
    extension(int x = 0) { public int A => x; }
    extension(string s = null) { }
    extension<T>(T t = default) { }
    extension(int = 1) { }
    extension(params int[] p) { }
    extension(this int q) { }
    extension(int a, int b = 2) { }
}
