"""Bounded managed fixtures. The only variable endpoint is an owned loopback server."""
from urllib.parse import urlparse


PROJECTS = ('Alpha/Alpha.csproj', 'Beta/Beta.csproj')
TAGS = ('alpha', 'beta', 'alpha-copy')


def records(origin):
    parsed = urlparse(origin)
    if (parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or not parsed.port
            or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password):
        raise ValueError('Session I/O fixtures require an exact owned loopback origin')
    source = '''using System;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using SharpForge.Runtime;

public class SessionIOProgram
{
    static string identity;
    static HttpClient client;
    static CancellationTokenSource pending;
    static TextBlock status;
    static bool busy;
    static int ticks;

    static async void Work(object sender, RoutedEventArgs args)
    {
        if (busy) return;
        busy = true;
        status.Text = identity + ":busy";
        Console.WriteLine(identity + ":begin");
        pending = new CancellationTokenSource();
        double[] values = new double[4096];
        for (int index = 0; index < values.Length; index++) values[index] = 0.5;
        var numerical = ParallelMath.SumAsync(values);
        var request = client.GetStringAsync("ORIGIN/hold/" + identity, pending.Token);
        double sum = await numerical;
        Console.WriteLine(identity + ":sum:" + sum);
        try
        {
            string body = await request;
            Console.WriteLine(identity + ":http:" + body);
        }
        catch (Exception error)
        {
            Console.WriteLine(identity + ":http-failed");
        }
        pending.Dispose();
        pending = null;
        busy = false;
        status.Text = identity + ":ready";
        Console.WriteLine(identity + ":done");
    }

    static void Cancel(object sender, RoutedEventArgs args)
    {
        if (pending != null) pending.Cancel();
    }

    static void Ping(object sender, RoutedEventArgs args)
    {
        ticks += 1;
        Console.WriteLine(identity + ":tick:" + ticks);
    }

    static void Main(string[] arguments)
    {
        identity = arguments[0];
        client = new HttpClient();
        ticks = 0;
        var panel = new StackPanel() { Width = 360, Spacing = 12 };
        status = new TextBlock() { Name = "SessionIOStatus", Text = identity + ":ready" };
        var work = new Button() { Name = "SessionIOWork", Content = "Run HTTP and numerical work" };
        var cancel = new Button() { Name = "SessionIOCancel", Content = "Cancel request" };
        var ping = new Button() { Name = "SessionIOPing", Content = "Independent callback" };
        work.Click += Work;
        cancel.Click += Cancel;
        ping.Click += Ping;
        panel.Children.Add(status);
        panel.Children.Add(work);
        panel.Children.Add(cancel);
        panel.Children.Add(ping);
        new Window() { Title = identity, Content = panel }.Activate();
        Console.WriteLine(identity + ":started");
    }
}
'''.replace('ORIGIN', origin)
    result = [{'path': 'SessionIO.slnx', 'text': '<Solution><Project Path="Alpha/Alpha.csproj" />'
               '<Project Path="Beta/Beta.csproj" /></Solution>'}]
    for project in PROJECTS:
        result.append({'path': project, 'text': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
                       '<OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework>'
                       '</PropertyGroup></Project>'})
        result.append({'path': project.split('/')[0] + '/Program.cs', 'text': source})
    return result
