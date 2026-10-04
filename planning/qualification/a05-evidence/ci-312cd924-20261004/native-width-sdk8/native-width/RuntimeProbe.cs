using System;
using System.Runtime.InteropServices;
static class RuntimeProbe {
    static void Main() {
        Console.WriteLine(RuntimeInformation.FrameworkDescription);
        Console.WriteLine(Environment.Version);
        Console.WriteLine(RuntimeInformation.RuntimeIdentifier);
        Console.WriteLine(IntPtr.Size);
        Console.WriteLine(RuntimeInformation.ProcessArchitecture);
    }
}
