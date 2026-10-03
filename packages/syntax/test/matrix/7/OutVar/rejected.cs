// langversion 6: expect CS8059 at 43 "int"
class C
{
    void M()
    {
        F(out int x);
    }
}
