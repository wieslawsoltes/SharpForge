class C
{
    void M()
    {
        outer: while (true) { break outer; }
    }
}
