// langversion 7.3: expect CS8370 at 37 "await"
class C
{
    void M()
    {
        await foreach (object x in xs) { }
    }
}
