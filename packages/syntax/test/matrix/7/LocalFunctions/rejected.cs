// langversion 6: expect CS8059 at 37 "int"
class C
{
    void M()
    {
        int Twice(int x) { return x * 2; }
    }
}
