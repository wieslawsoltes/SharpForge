// langversion 13: expect CS9260 at 21 "extension"
static class E
{
    extension<T>(T value)
    {
        public bool IsNull => value == null;
    }
}
