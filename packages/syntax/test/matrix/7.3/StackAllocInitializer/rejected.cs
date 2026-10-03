// langversion 7.2: expect CS8320 at 70 "{"
unsafe class C
{
    void M()
    {
        int* p = stackalloc int[] { 1, 2 };
    }
}
