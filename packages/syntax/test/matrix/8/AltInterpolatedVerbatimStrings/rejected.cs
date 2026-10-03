// langversion 7.3: expect CS8370 at 48 "@$\"{x}\""
class C
{
    void M()
    {
        string s = @$"{x}";
    }
}
