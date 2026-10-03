class C
{
    static bool F(out int value) { value = 1; return true; }
    int field = F(out var x) ? x : 0;
}
