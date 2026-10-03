// langversion 1: expect CS8022 at 67 "yield"
class C
{
    System.Collections.IEnumerable Items()
    {
        yield return 1;
    }
}
