// langversion 7.3: expect CS8370 at 37 "using"
class C
{
    void M()
    {
        using System.IDisposable d = Open();
    }
}
