unsafe struct Buffer
{
    public fixed byte Bytes[16];
    fixed int a[4], b[8];
    internal fixed char Name[Size * 2];
    const int Size = 8;
    void M(int[] data, string text)
    {
        fixed (int* p = data) { p[0] = 1; }
        fixed (int* p = &data[0], q = data) *p = *q;
        fixed (char* c = text) fixed (byte* b = Bytes) { }
        fixed (void* v = &this) { }
        fixed (int* p = stackalloc int[2]) { }
        fixed (byte* first = &Bytes[0])
        {
            first[1] = Bytes[2];
        }
    }
}
