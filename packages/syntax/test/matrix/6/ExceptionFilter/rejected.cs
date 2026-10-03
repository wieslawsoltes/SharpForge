// langversion 5: expect CS8026 at 72 "when"
class C
{
    void M()
    {
        try { } catch (System.Exception e) when (e != null) { }
    }
}
