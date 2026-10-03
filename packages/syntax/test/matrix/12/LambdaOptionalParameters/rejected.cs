// langversion 11: expect CS9058 at 52 "="
class C
{
    void M()
    {
        var f = (int x = 1) => x;
    }
}
