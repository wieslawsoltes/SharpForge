// langversion 8: expect CS8400 at 50 "with"
class C
{
    void M()
    {
        object r = a with { X = 1 };
    }
}
