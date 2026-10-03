class Jumps
{
    int M(int x)
    {
        goto start;
    start:
        x++;
        if (x < 10) goto start;
        switch (x)
        {
            case 1: goto case 2;
            case 2: goto default;
            case 3: goto end;
            case 4: goto case 1 + 2;
            default: break;
        }
        outer: for (;;) { inner: while (true) { goto outer; } }
        empty: ;
        block: { }
        decl: int y = 2;
        nested: again: x--;
        label: if (x > 0) goto label;
        @goto: goto @goto;
        tryLabel: try { goto end; } finally { }
        end: return x + y;
    }
}
