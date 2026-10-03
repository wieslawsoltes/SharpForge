// langversion 6: expect CS8059 at 53 "throw"
class C
{
    void M()
    {
        object o = a ?? throw e;
    }
}
