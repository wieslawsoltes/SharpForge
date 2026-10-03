class Blocks
{
    object sync = new object();
    int M(int x, object o)
    {
        lock (sync) { x++; }
        lock (this) x--;
        lock (typeof(Blocks)) lock (o) { }
        checked { x = x * 2; }
        unchecked { x = x * 2; }
        int a = checked(x + 1), b = unchecked((int)(x * 2L));
        int c = checked((x)) + unchecked(-x);
        switch (x)
        {
            case 0:
            case 1:
                x = 1;
                break;
            case 2: case 3: { x = 2; break; }
            case 4:
                x = 4;
                goto case 0;
            default:
                x = 0;
                return x;
            case 5: throw new System.Exception();
        }
        switch (o) { case null: break; }
        switch (x) { default: break; case 1: break; }
        switch (x) { case 1 + 2: case (int)3L: case Constants.Four: break; }
        switch (x) { case 1: x++; x--; break; case 2: default: x = 0; break; }
        switch (x) { }
        return a + b + c;
    }
}
