delegate bool TryParse(string text, out int result);
class C
{
    TryParse parse = (text, out result) => int.TryParse(text, out result);
}
