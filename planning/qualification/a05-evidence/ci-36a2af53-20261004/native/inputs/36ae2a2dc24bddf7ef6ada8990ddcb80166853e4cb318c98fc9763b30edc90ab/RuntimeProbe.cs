using System;
using System.Runtime.InteropServices;
static class RuntimeProbe {
    static void Main() {
        Console.WriteLine(RuntimeInformation.FrameworkDescription);
        Console.WriteLine(Environment.Version);
        Console.WriteLine(RuntimeInformation.RuntimeIdentifier);
    }
}
