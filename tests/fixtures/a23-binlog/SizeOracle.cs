using System;
using System.IO;
using System.Runtime.Loader;
using System.Text.Json;
using Microsoft.Build.Framework;
using Microsoft.Build.Logging;

internal sealed class EventSource : IEventSource
{
    public event AnyEventHandler AnyEventRaised;
    public event BuildFinishedEventHandler BuildFinished;
    public event BuildStartedEventHandler BuildStarted;
    public event CustomBuildEventHandler CustomEventRaised;
    public event BuildErrorEventHandler ErrorRaised;
    public event BuildMessageEventHandler MessageRaised;
    public event ProjectFinishedEventHandler ProjectFinished;
    public event ProjectStartedEventHandler ProjectStarted;
    public event BuildStatusEventHandler StatusEventRaised;
    public event TargetFinishedEventHandler TargetFinished;
    public event TargetStartedEventHandler TargetStarted;
    public event TaskFinishedEventHandler TaskFinished;
    public event TaskStartedEventHandler TaskStarted;
    public event BuildWarningEventHandler WarningRaised;

    internal void Raise(BuildEventArgs value) => AnyEventRaised?.Invoke(this, value);
}

internal static class Program
{
    private static void Main(string[] arguments)
    {
        AssemblyLoadContext.Default.Resolving += (_, name) =>
        {
            string path = Path.Combine(arguments[1], name.Name + ".dll");
            return File.Exists(path) ? AssemblyLoadContext.Default.LoadFromAssemblyPath(path) : null;
        };
        Create(arguments[0]);
    }

    private static void Create(string path)
    {
        var source = new EventSource();
        var logger = new BinaryLogger { Parameters = path + ";ProjectImports=None", Verbosity = LoggerVerbosity.Diagnostic };
        logger.Initialize(source);
        source.Raise(new BuildStartedEventArgs("Large binary-log qualification", null));
        var random = new Random(2304);
        var characters = new char[100000];
        for (int index = 0; index < 1200; index++)
        {
            for (int offset = 0; offset < characters.Length; offset++) characters[offset] = (char)(0x4e00 + random.Next(0x5000));
            source.Raise(new BuildMessageEventArgs("Record " + index + ": " + new string(characters), null, "SizeOracle", MessageImportance.High));
        }
        source.Raise(new BuildFinishedEventArgs("Large binary-log qualification finished", null, true));
        logger.Shutdown();
        Console.WriteLine(JsonSerializer.Serialize(new { bytes = new FileInfo(path).Length, records = 1200 }));
    }
}
