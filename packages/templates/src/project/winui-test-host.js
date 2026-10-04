/** A WinUI-owned entry point hosts MSTest 3.8.3/MTP without creating a second Application instance. */
export function winuiTestApplication(namespace) {
  return `using System;
using System.Linq;
using Microsoft.Testing.Platform.Builder;
using Microsoft.UI.Xaml;
using Microsoft.VisualStudio.TestTools.UnitTesting.AppContainer;

namespace ${namespace};

public partial class App : Application
{
    private Window? window;

    public App() { InitializeComponent(); }

    protected override async void OnLaunched(LaunchActivatedEventArgs args)
    {
        try
        {
            window = new MainWindow();
            window.Activate();
            UITestMethodAttribute.DispatcherQueue = window.DispatcherQueue;
            string[] arguments = Environment.GetCommandLineArgs().Skip(1)
                .Where(value => !value.Contains("EnableMSTestRunner")).ToArray();
            var builder = await TestApplication.CreateBuilderAsync(arguments);
            builder.AddSelfRegisteredExtensions(arguments);
            using var runner = await builder.BuildAsync();
            Environment.ExitCode = await runner.RunAsync();
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
            Environment.ExitCode = 1;
        }
        finally
        {
            window?.Close();
            Exit();
        }
    }
}
`;
}

export function winuiTestSource(namespace) {
  return `using Microsoft.UI.Xaml.Controls;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Microsoft.VisualStudio.TestTools.UnitTesting.AppContainer;

namespace ${namespace};

[TestClass]
public class UnitTest1
{
    [TestMethod]
    public void AdditionReturnsExpectedValue()
    {
        Assert.AreEqual(4, 2 + 2);
    }

    [UITestMethod]
    public void CreatesControlOnUiThread()
    {
        var grid = new Grid();
        Assert.IsTrue(grid.DispatcherQueue.HasThreadAccess);
        Assert.AreEqual(0, grid.Children.Count);
    }
}
`;
}
