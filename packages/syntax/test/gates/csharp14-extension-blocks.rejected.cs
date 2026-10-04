// langversion 13: expect the language-version diagnostics recorded in the .roslyn.json beside this file
static class E
{
    extension(int x) { }
    public extension(int y) { }
    extension(int z);
    extension(int w) => 1;
    [System.Obsolete] extension(string s) { }
    extension<T>(T value) where T : class
    {
        public bool IsNull() => value == null;
    }
    extension<T>(T) { }
    extension(int open)
    {
        public int Twice => open * 2;
    }
}
class extension
{
    extension(int x) { }
    public extension() { }
    extension M() => null;
}
