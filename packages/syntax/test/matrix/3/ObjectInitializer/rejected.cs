// langversion 2: expect CS8023 at 49 "{"
class C
{
    void M()
    {
        C c = new C { X = 1 };
    }
}
