using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;

// Compiled by the actual selected SDK, never substituted with a process simulator.
public static class NativeProbe
{
    public static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        if (args.Length == 0 || args[0] == "info")
        {
            Console.WriteLine(JsonSerializer.Serialize(new {
                runtime = Environment.Version.ToString(),
                architecture = RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant(),
                os = RuntimeInformation.OSDescription,
                value = 42, unicode = "café λ"
            }));
            return 0;
        }
        if (args[0] == "allocate")
        {
            var start = GC.GetAllocatedBytesForCurrentThread();
            int checksum = 0;
            for (int i = 0; i < 1000; i++)
            {
                var bytes = new byte[128]; bytes[0] = (byte)(i % 251);
                checksum += bytes[0]; GC.KeepAlive(bytes);
            }
            Console.WriteLine(JsonSerializer.Serialize(new {
                allocatedBytes = GC.GetAllocatedBytesForCurrentThread() - start, checksum
            }));
            return 0;
        }
        if (args[0] == "tree")
        {
            using var child = Process.Start(new ProcessStartInfo {
                FileName = Environment.GetEnvironmentVariable("SHARPFORGE_NATIVE_DOTNET") ?? "dotnet",
                ArgumentList = { Assembly.GetExecutingAssembly().Location, "sleep" },
                UseShellExecute = false
            })!;
            File.WriteAllText(args[1], JsonSerializer.Serialize(new { parent = Environment.ProcessId, child = child.Id }));
            Thread.Sleep(120000);
            return 0;
        }
        if (args[0] == "sleep") { Thread.Sleep(120000); return 0; }
        if (args[0] == "noise") { Console.WriteLine(new string('x', 16384)); return 0; }
        if (args[0] == "exit") return int.Parse(args[1]);
        throw new ArgumentException("Unknown native fixture mode");
    }
}
