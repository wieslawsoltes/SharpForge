// langversion 2: expect CS8023 at 48 "new"
class C
{
    void M()
    {
        object o = new { A = 1 };
    }
}
