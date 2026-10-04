import { wrapNamespace, winuiUsings } from '../common.js';

const consoleBodies = {
  console: '    public static void Main()\n    {\n        Console.WriteLine("Hello, world!");\n    }',
  'console-async': '    public static async Task Main()\n    {\n        await Task.Delay(1);\n' +
    '        Console.WriteLine("Hello, async world!");\n    }',
  'test-console': '    public static void Main()\n    {\n        int actual = Add(20, 22);\n' +
    '        if (actual != 42)\n            throw new Exception("Expected 42");\n' +
    '        Console.WriteLine("All self-tests passed.");\n    }\n\n' +
    '    private static int Add(int a, int b)\n    {\n        return a + b;\n    }'
};

export function consoleSource(id, namespace) {
  return wrapNamespace(namespace, 'public class Program\n{\n' + consoleBodies[id] + '\n}',
    'using System;\n' + (id === 'console-async' ? 'using System.Threading.Tasks;\n' : ''));
}

export function navigationSource(namespace) {
  return wrapNamespace(namespace, `public class Shell
{
    public StackPanel View { get; private set; }
    private ContentControl content;
    private MainPage home = new MainPage();
    private SettingsPage settings = new SettingsPage();
    public Shell()
    {
        View = new StackPanel();
        View.Spacing = 12;
        StackPanel navigation = new StackPanel();
        navigation.Orientation = Orientation.Horizontal;
        navigation.Spacing = 8;
        Button homeButton = new Button() { Content = "Home" };
        homeButton.Click += ShowHome;
        Button settingsButton = new Button() { Content = "Settings" };
        settingsButton.Click += ShowSettings;
        navigation.Children.Add(homeButton);
        navigation.Children.Add(settingsButton);
        content = new ContentControl();
        content.Content = home.View;
        View.Children.Add(navigation);
        View.Children.Add(content);
    }
    private void ShowHome(object sender, RoutedEventArgs args)
    {
        content.Content = home.View;
    }
    private void ShowSettings(object sender, RoutedEventArgs args)
    {
        content.Content = settings.View;
    }
}`, winuiUsings);
}

export function winuiProgramSource({ name, ns }, navigation) {
  const page = navigation ? 'Shell' : 'MainPage';
  return wrapNamespace(ns, 'public class Program\n{\n    public static void Main()\n    {\n' +
    `        Window window = new Window();\n        window.Title = "${name}";\n        ${page} page = new ${page}();\n` +
    '        window.Content = page.View;\n        window.Activate();\n    }\n}', winuiUsings);
}

export function legacyReadme(name, library, winui) {
  const description = winui ? 'Open this project in SharpForge and Run. This is a code-first WinUI **web profile**, ' +
    'not a Windows App SDK project. Components expose a real WinUI-shaped control through `.View`. ' +
    'Native WinUI base-class inheritance, XAML, dependency properties and control templates are not supplied by this template. ' +
    'No Windows App SDK NuGet dependency is implied.' :
    'Open this SDK-style project in SharpForge, or use the installed .NET SDK for native builds. ' +
    'Browser builds use the supported C# subset and source-combined project references.';
  return `# ${name}\n\n${description}\n\n` +
    (library ? 'This project is a library; add a project reference from an application.' : 'The entry point is `Program.Main`.') + '\n';
}
