// langversion 6: expect CS8059 at 48 "is"
class C
{
    void M()
    {
        bool b = o is int i;
    }
}
