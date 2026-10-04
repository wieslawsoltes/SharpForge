using System.Diagnostics;
using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;
using Microsoft.Build.Framework;
using Microsoft.Build.Logging;

internal static class Program
{
    private static int Main(string[] arguments)
    {
        if (arguments.Length != 4) return 2;
        string input = arguments[0], output = arguments[1], sdkDirectory = arguments[2];
        long maximumBytes = long.Parse(arguments[3], System.Globalization.CultureInfo.InvariantCulture);
        AssemblyLoadContext.Default.Resolving += (_, name) =>
        {
            string path = Path.Combine(sdkDirectory, name.Name + ".dll");
            return File.Exists(path) ? AssemblyLoadContext.Default.LoadFromAssemblyPath(path) : null;
        };
        try { return Replay(input, output, maximumBytes); }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.GetType().Name + ": " + error.Message);
            return 1;
        }
    }

    private static int Replay(string input, string output, long maximumBytes)
    {
        using var writer = new StreamWriter(new FileStream(output, FileMode.CreateNew, FileAccess.Write, FileShare.Read));
        writer.NewLine = "\n";
        long written = 0, count = 0, peakWorkingSetBytes = 0;
        using var process = Process.GetCurrentProcess();
        var reader = new BinaryLogReplayEventSource { AllowForwardCompatibility = true };
        void Write(object record)
        {
            string line = JsonSerializer.Serialize(record);
            int lineBytes = System.Text.Encoding.UTF8.GetByteCount(line);
            if (lineBytes > 4 * 1024 * 1024) throw new InvalidDataException("Binlog event size limit exceeded");
            written += lineBytes + 1;
            if (written > maximumBytes || ++count > 10_000_000) throw new InvalidDataException("Binlog event spool limit exceeded");
            process.Refresh();
            peakWorkingSetBytes = Math.Max(peakWorkingSetBytes, process.PeakWorkingSet64);
            if (process.WorkingSet64 > 512L * 1024 * 1024) throw new InvalidDataException("Binlog reader memory limit exceeded");
            writer.WriteLine(line);
        }
        reader.RecoverableReadError += error => Write(new { kind = "ReaderWarning", message = error.GetFormattedMessage() });
        reader.AnyEventRaised += (_, value) => Write(Convert(value));
        reader.Replay(input);
        writer.Flush();
        var version = FileVersionInfo.GetVersionInfo(typeof(BinaryLogReplayEventSource).Assembly.Location);
        Console.WriteLine(JsonSerializer.Serialize(new { events = count, bytes = written, peakWorkingSetBytes,
            readerVersion = typeof(BinaryLogReplayEventSource).Assembly.GetName().Version?.ToString(),
            readerFileVersion = version.FileVersion, readerProductVersion = version.ProductVersion }));
        return 0;
    }

    private static object Convert(BuildEventArgs value)
    {
        BuildEventContext? context = value.BuildEventContext;
        var record = new Dictionary<string, object?>
        {
            ["kind"] = value.GetType().Name.Replace("EventArgs", ""),
            ["timestamp"] = value.Timestamp.ToUniversalTime().Ticks / TimeSpan.TicksPerMillisecond,
            ["message"] = value.Message,
            ["context"] = context is null ? null : new
            {
                nodeId = context.NodeId, projectContextId = context.ProjectContextId,
                projectInstanceId = context.ProjectInstanceId, targetId = context.TargetId, taskId = context.TaskId
            }
        };
        switch (value)
        {
            case ProjectStartedEventArgs project:
                record["name"] = project.ProjectFile;
                record["projectFile"] = project.ProjectFile;
                record["targets"] = project.TargetNames;
                if (project.ParentProjectBuildEventContext is { } parent)
                    record["parentContext"] = new { nodeId = parent.NodeId, projectContextId = parent.ProjectContextId };
                break;
            case ProjectFinishedEventArgs project:
                record["projectFile"] = project.ProjectFile; record["succeeded"] = project.Succeeded;
                break;
            case TargetStartedEventArgs target:
                record["name"] = target.TargetName; record["projectFile"] = target.ProjectFile;
                break;
            case TargetFinishedEventArgs target:
                record["name"] = target.TargetName; record["succeeded"] = target.Succeeded;
                break;
            case TaskStartedEventArgs task:
                record["name"] = task.TaskName; record["projectFile"] = task.ProjectFile;
                break;
            case TaskFinishedEventArgs task:
                record["name"] = task.TaskName; record["succeeded"] = task.Succeeded;
                break;
            case BuildErrorEventArgs error:
                record["code"] = error.Code; record["file"] = error.File; record["line"] = error.LineNumber;
                record["column"] = error.ColumnNumber; record["endLine"] = error.EndLineNumber;
                record["endColumn"] = error.EndColumnNumber; record["subcategory"] = error.Subcategory;
                record["projectFile"] = error.ProjectFile; record["severity"] = "error";
                break;
            case BuildWarningEventArgs warning:
                record["code"] = warning.Code; record["file"] = warning.File; record["line"] = warning.LineNumber;
                record["column"] = warning.ColumnNumber; record["endLine"] = warning.EndLineNumber;
                record["endColumn"] = warning.EndColumnNumber; record["subcategory"] = warning.Subcategory;
                record["projectFile"] = warning.ProjectFile; record["severity"] = "warning";
                break;
            case BuildFinishedEventArgs finished:
                record["succeeded"] = finished.Succeeded;
                break;
        }
        return record;
    }
}
