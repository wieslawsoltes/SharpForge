// langversion 6: expect CS8059 at 48 "("
class C
{
    void M()
    {
        object t = (1, 2);
    }
}
