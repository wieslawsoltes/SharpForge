using System;
using System.Text;

// The adapter's transport is UTF-8; the tested program and its DLL stay unchanged.
internal static class StartupHook
{
    public static void Initialize()
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
    }
}
