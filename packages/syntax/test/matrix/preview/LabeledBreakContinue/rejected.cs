// langversion 14: expect CS8652 at 65 "outer"
class C
{
    void M()
    {
        outer: while (true) { break outer; }
    }
}
