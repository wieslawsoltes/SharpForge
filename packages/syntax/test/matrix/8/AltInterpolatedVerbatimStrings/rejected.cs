// langversion 7.3: expect CS8401 at 48 "@$\""
class C
{
    void M()
    {
        string s = @$"{x}";
    }
}
