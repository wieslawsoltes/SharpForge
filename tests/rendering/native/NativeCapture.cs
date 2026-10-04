using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Threading.Tasks;
using System.Xml;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Markup;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Foundation;
using Windows.Graphics;
using Windows.Storage.Streams;

internal sealed class NativeCapture
{
    private readonly Window window;
    private readonly string output;
    internal NativeCapture(Window window, string output) { this.window = window; this.output = output; }

    internal static SizeInt32 Dimensions(Fixture fixture)
    {
        if (!double.IsFinite(fixture.Width) || !double.IsFinite(fixture.Height) || !double.IsFinite(fixture.Dpr) ||
            fixture.Width is < 1 or > 2048 || fixture.Height is < 1 or > 2048 || fixture.Dpr is < 0.5 or > 4)
            throw new InvalidDataException("SFNPIX011: Invalid native DIP dimensions or scale");
        int width = (int)Math.Ceiling(fixture.Width * fixture.Dpr), height = (int)Math.Ceiling(fixture.Height * fixture.Dpr);
        if (width > 4096 || height > 4096 || (long)width * height > 4 * 1024 * 1024)
            throw new InvalidDataException("SFNPIX011: Native pixel budget exceeded");
        return new SizeInt32(width, height);
    }

    internal async Task<object> Capture(Fixture fixture)
    {
        ValidateProfile(fixture.Xaml);
        object content;
        try { content = XamlReader.Load(fixture.Xaml); }
        catch (Exception error)
        {
            if (fixture.Expected != "load-error") throw;
            return new { id = fixture.Id, status = "load-error", xamlSha256 = fixture.XamlSha256,
                exception = error.GetType().FullName, hresult = error.HResult };
        }
        if (fixture.Expected != "pixels") throw new InvalidOperationException("SFNPIX012: Expected native XAML load failure did not occur");
        if (content is not FrameworkElement element) throw new InvalidDataException("SFNPIX012: Native XAML root must be FrameworkElement");
        var root = await Attach(fixture, element);
        if (fixture.FocusTarget != null)
        {
            if (element.FindName(fixture.FocusTarget) is not Control control || !control.Focus(FocusState.Keyboard))
                throw new InvalidOperationException("SFNPIX012: Native keyboard focus target is unavailable");
            await NextFrame();
        }
        var dimensions = Dimensions(fixture);
        var bytes = await StablePixels(root, dimensions);
        string file = fixture.Id + ".bgra";
        using (var stream = new FileStream(Path.Combine(output, file), FileMode.CreateNew, FileAccess.Write)) stream.Write(bytes);
        return new { id = fixture.Id, status = "pixels", xamlSha256 = fixture.XamlSha256, file,
            dimensions = new[] { dimensions.Width, dimensions.Height }, byteCount = bytes.Length,
            bgraSha256 = Convert.ToHexStringLower(SHA256.HashData(bytes)), pixelFormat = "BGRA8", alphaMode = "premultiplied",
            colorSpace = "srgb", origin = "top-left", rasterizationScale = root.XamlRoot.RasterizationScale,
            rasterScaleMode = "render-target-explicit-size", actualTheme = root.ActualTheme.ToString(), focusTarget = fixture.FocusTarget };
    }

    private static async Task<byte[]> StablePixels(FrameworkElement element, SizeInt32 dimensions)
    {
        string? previous = null;
        int consecutive = 0;
        for (int frame = 0; frame < 120; frame++)
        {
            await NextFrame();
            var bytes = await Rasterize(element, dimensions);
            string fingerprint = Convert.ToHexStringLower(SHA256.HashData(bytes));
            consecutive = fingerprint == previous ? consecutive + 1 : 1;
            if (consecutive == 3) return bytes;
            previous = fingerprint;
        }
        throw new InvalidOperationException("SFNPIX016: Native pixels did not stabilize for three captures within 120 frames");
    }

    private static async Task<byte[]> Rasterize(FrameworkElement element, SizeInt32 dimensions)
    {
        var bitmap = new RenderTargetBitmap();
        await bitmap.RenderAsync(element, dimensions.Width, dimensions.Height);
        var buffer = await bitmap.GetPixelsAsync();
        int expectedBytes = checked(dimensions.Width * dimensions.Height * 4);
        if (bitmap.PixelWidth != dimensions.Width || bitmap.PixelHeight != dimensions.Height || buffer.Length != expectedBytes)
            throw new InvalidDataException("SFNPIX013: Native RenderTargetBitmap returned different dimensions or bytes");
        var bytes = new byte[expectedBytes];
        using (var reader = DataReader.FromBuffer(buffer)) reader.ReadBytes(bytes);
        return bytes;
    }

    private async Task<Grid> Attach(Fixture fixture, FrameworkElement element)
    {
        var root = new Grid { Width = fixture.Width, Height = fixture.Height,
            RequestedTheme = fixture.Theme == "Dark" ? ElementTheme.Dark : ElementTheme.Light,
            HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top };
        root.Children.Add(element);
        var loaded = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        RoutedEventHandler handler = (_, _) => loaded.TrySetResult(true);
        root.Loaded += handler;
        window.Content = root;
        try { await loaded.Task.WaitAsync(TimeSpan.FromSeconds(15)); }
        finally { root.Loaded -= handler; }
        double scale = root.XamlRoot.RasterizationScale;
        window.AppWindow.ResizeClient(new SizeInt32((int)Math.Ceiling(fixture.Width * scale), (int)Math.Ceiling(fixture.Height * scale)));
        await NextTurn();
        root.Measure(new Size(fixture.Width, fixture.Height));
        root.Arrange(new Rect(0, 0, fixture.Width, fixture.Height));
        root.UpdateLayout();
        await NextFrame();
        root.UpdateLayout();
        await NextFrame();
        return root;
    }

    private static async Task NextTurn()
    {
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!DispatcherQueue.GetForCurrentThread().TryEnqueue(DispatcherQueuePriority.Low, () => completion.TrySetResult(true)))
            throw new InvalidOperationException("SFNPIX014: Native dispatcher rejected capture callback");
        await completion.Task.WaitAsync(TimeSpan.FromSeconds(15));
    }

    private static async Task NextFrame()
    {
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        EventHandler<object> handler = (_, _) => completion.TrySetResult(true);
        CompositionTarget.Rendering += handler;
        try { await completion.Task.WaitAsync(TimeSpan.FromSeconds(15)); }
        finally { CompositionTarget.Rendering -= handler; }
    }

    private static void ValidateProfile(string xaml)
    {
        var types = new HashSet<string> { "Canvas", "Grid", "StackPanel", "Border", "Rectangle", "Ellipse", "Line", "Path", "Polygon", "Polyline",
            "SolidColorBrush", "LinearGradientBrush", "GradientStop", "RotateTransform", "ScaleTransform", "TranslateTransform", "SkewTransform",
            "TransformGroup", "MatrixTransform", "RectangleGeometry", "PathGeometry", "PathFigure", "LineSegment", "ArcSegment", "BezierSegment",
            "QuadraticBezierSegment", "TextBlock", "Run", "Span", "Bold", "Italic", "Underline", "LineBreak", "Button", "CheckBox", "RadioButton",
            "ToggleSwitch", "Slider", "ProgressBar", "RowDefinition", "ColumnDefinition" };
        var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 256 * 1024 };
        using var reader = XmlReader.Create(new StringReader(xaml), settings);
        while (reader.Read())
        {
            if (reader.Depth > 64) throw new InvalidDataException("SFNPIX015: Native XAML depth budget exceeded");
            if (reader.NodeType != XmlNodeType.Element) continue;
            if (reader.NamespaceURI != "http://schemas.microsoft.com/winfx/2006/xaml/presentation" || !types.Contains(reader.LocalName.Split('.')[0]))
                throw new InvalidDataException("SFNPIX015: Native capture profile excludes this type or namespace: " + reader.LocalName);
            while (reader.MoveToNextAttribute())
            {
                bool namespaceDeclaration = reader.NamespaceURI == "http://www.w3.org/2000/xmlns/";
                bool xamlName = reader.NamespaceURI == "http://schemas.microsoft.com/winfx/2006/xaml" && reader.LocalName == "Name";
                if (reader.NamespaceURI.Length != 0 && !namespaceDeclaration && !xamlName || reader.LocalName == "Source" ||
                    !namespaceDeclaration && reader.Value.TrimStart().StartsWith("{", StringComparison.Ordinal))
                    throw new InvalidDataException("SFNPIX015: Native capture profile excludes external sources, markup extensions, and custom attributes");
            }
            reader.MoveToElement();
        }
    }
}
