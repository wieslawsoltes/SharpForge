// langversion 5: expect CS8026 at 51 "["
class C
{
    void M()
    {
        C c = new C { [1] = 2 };
    }
}
