// langversion 8: expect CS8400 at 43 "new"
class C
{
    void M()
    {
        C c = new();
    }
}
