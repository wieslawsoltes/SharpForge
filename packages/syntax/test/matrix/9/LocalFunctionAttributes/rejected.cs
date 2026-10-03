// langversion 8: expect CS8400 at 37 "[System.Obsolete]"
class C
{
    void M()
    {
        [System.Obsolete] void Local() { }
    }
}
