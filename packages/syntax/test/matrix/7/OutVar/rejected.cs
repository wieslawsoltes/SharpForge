// langversion 6: expect CS8059 at 39 "out"
class C
{
    void M()
    {
        F(out int x);
    }
}
