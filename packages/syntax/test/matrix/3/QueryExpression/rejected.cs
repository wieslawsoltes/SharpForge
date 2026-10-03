// langversion 2: expect CS8023 at 48 "from"
class C
{
    void M()
    {
        object q = from x in xs select x;
    }
}
