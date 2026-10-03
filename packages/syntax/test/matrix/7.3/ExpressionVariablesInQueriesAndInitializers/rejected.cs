// langversion 7.2: expect CS8320 at 93 "var x"
class C
{
    static bool F(out int value) { value = 1; return true; }
    int field = F(out var x) ? x : 0;
}
