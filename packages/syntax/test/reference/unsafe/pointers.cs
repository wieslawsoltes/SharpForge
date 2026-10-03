unsafe class Pointers
{
    int* p; void* v; int** pp; char*[] array; byte*[][] jagged;
    struct Node { public int Value; public Node* Next; }
    static unsafe int Sum(int* values, int count, void* context)
    {
        int total = 0;
        for (int* q = values; q < values + count; q++) total += *q;
        int x = 1; int* px = &x; *px = 2; px[0] = 3; (*px)++;
        Node n; Node* pn = &n; pn->Value = 4; pn->Next->Value = 5; (*pn).Value = 6;
        int size = sizeof(int) + sizeof(Node) + sizeof(int*);
        a * b;
        a * b = c;
        T* t;
        a.b * c;
        x = a * b;
        M(a * b);
        void* raw = (void*)px; int* back = (int*)raw; long address = (long)px;
        bool same = px == null || px != back && px < back;
        unsafe { int** ppx = &px; **ppx = 7; }
        int* end = px + 1; long diff = end - px; px++; --px;
        var text = pn->ToString() + (&n)->Value + pn[0].Value;
        return total + *&x + -*px;
    }
    unsafe static void Local() { unsafe void Inner() { } }
    unsafe delegate void* Alloc(int size);
    public unsafe int* Field;
}
