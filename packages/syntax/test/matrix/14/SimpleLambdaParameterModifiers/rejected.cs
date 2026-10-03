// langversion 13: expect CS9260 at 91 "out result"
delegate bool TryParse(string text, out int result);
class C
{
    TryParse parse = (text, out result) => int.TryParse(text, out result);
}
