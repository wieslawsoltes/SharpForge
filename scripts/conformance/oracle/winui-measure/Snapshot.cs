using System;
using System.Collections.Generic;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using Windows.Foundation;

internal static class Snapshot
{
    private const int Limit = 2048;
    private static object Number(double value) => double.IsFinite(value) ? value : double.IsNaN(value) ? "NaN" : value > 0 ? "Infinity" : "-Infinity";
    private static object Size(Size value) => new { width = Number(value.Width), height = Number(value.Height) };
    private static object Rect(Rect value) => new { x = Number(value.X), y = Number(value.Y), width = Number(value.Width), height = Number(value.Height) };
    private static object Thickness(Thickness value) => new { left = Number(value.Left), top = Number(value.Top), right = Number(value.Right), bottom = Number(value.Bottom) };
    private static object Property(DependencyObject element, DependencyProperty property, object? value) => new
    {
        value, hasLocalValue = !ReferenceEquals(element.ReadLocalValue(property), DependencyProperty.UnsetValue)
    };
    private static Dictionary<string, object?> Properties(FrameworkElement element)
    {
        var properties = new Dictionary<string, object?>
        {
            ["width"] = Property(element, FrameworkElement.WidthProperty, Number(element.Width)),
            ["height"] = Property(element, FrameworkElement.HeightProperty, Number(element.Height)),
            ["minWidth"] = Number(element.MinWidth), ["maxWidth"] = Number(element.MaxWidth),
            ["minHeight"] = Number(element.MinHeight), ["maxHeight"] = Number(element.MaxHeight),
            ["margin"] = Thickness(element.Margin), ["visibility"] = element.Visibility.ToString(),
            ["horizontalAlignment"] = element.HorizontalAlignment.ToString(), ["verticalAlignment"] = element.VerticalAlignment.ToString(),
            ["flowDirection"] = element.FlowDirection.ToString(), ["opacity"] = Number(element.Opacity),
            ["isHitTestVisible"] = element.IsHitTestVisible, ["actualTheme"] = element.ActualTheme.ToString()
        };
        if (element is Control control)
        {
            properties["isEnabled"] = Property(control, Control.IsEnabledProperty, control.IsEnabled);
            properties["isTabStop"] = Property(control, Control.IsTabStopProperty, control.IsTabStop);
            properties["padding"] = Thickness(control.Padding);
            properties["fontFamily"] = control.FontFamily.Source;
            properties["fontSize"] = Number(control.FontSize);
            properties["fontWeight"] = control.FontWeight.Weight;
            properties["horizontalContentAlignment"] = control.HorizontalContentAlignment.ToString();
            properties["verticalContentAlignment"] = control.VerticalContentAlignment.ToString();
        }
        if (element is TextBlock text)
        {
            properties["text"] = text.Text; properties["fontSize"] = Number(text.FontSize);
            properties["textAlignment"] = text.TextAlignment.ToString(); properties["textWrapping"] = text.TextWrapping.ToString();
        }
        if (element is TextBox input) properties["text"] = input.Text;
        if (element is ToggleButton toggle) properties["isChecked"] = toggle.IsChecked;
        if (element is RangeBase range)
        {
            properties["minimum"] = Number(range.Minimum); properties["maximum"] = Number(range.Maximum); properties["value"] = Number(range.Value);
        }
        if (element is Border border)
        {
            properties["padding"] = Thickness(border.Padding); properties["borderThickness"] = Thickness(border.BorderThickness);
        }
        return properties;
    }
    internal static object Visual(FrameworkElement root)
    {
        int count = 0;
        object Visit(DependencyObject node, string path, int depth)
        {
            if (++count > Limit || depth > 64) throw new InvalidOperationException("Visual tree exceeds measurement bound");
            var children = new List<object>();
            for (int index = 0; index < VisualTreeHelper.GetChildrenCount(node); index++)
                children.Add(Visit(VisualTreeHelper.GetChild(node, index), path + "/" + index, depth + 1));
            if (node is FrameworkElement element) return new
            {
                path, type = node.GetType().FullName, name = element.Name, layoutSlot = Rect(LayoutInformation.GetLayoutSlot(element)),
                desiredSize = Size(element.DesiredSize), actualSize = new { width = Number(element.ActualWidth), height = Number(element.ActualHeight) },
                properties = Properties(element), children
            };
            return new { path, type = node.GetType().FullName, children };
        }
        return Visit(root, "0", 0);
    }
    internal static object Automation(FrameworkElement root)
    {
        int peers = 0, scanned = 0;
        object Visit(AutomationPeer peer, int depth)
        {
            if (++peers > Limit || depth > 64) throw new InvalidOperationException("Automation tree exceeds measurement bound");
            var children = new List<object>();
            var nativeChildren = peer.GetChildren();
            if (nativeChildren != null) foreach (var child in nativeChildren) children.Add(Visit(child, depth + 1));
            return new { type = peer.GetType().FullName, className = peer.GetClassName(), controlType = peer.GetAutomationControlType().ToString(),
                name = peer.GetName(), automationId = peer.GetAutomationId(), isEnabled = peer.IsEnabled(),
                isContentElement = peer.IsContentElement(), isControlElement = peer.IsControlElement(), children };
        }
        var roots = new List<object>();
        void FindRoots(DependencyObject node, int depth)
        {
            if (++scanned > Limit || depth > 64) throw new InvalidOperationException("Automation root search exceeds measurement bound");
            var peer = node is UIElement element ? FrameworkElementAutomationPeer.CreatePeerForElement(element) : null;
            if (peer != null) { roots.Add(Visit(peer, 0)); return; }
            for (int index = 0; index < VisualTreeHelper.GetChildrenCount(node); index++) FindRoots(VisualTreeHelper.GetChild(node, index), depth + 1);
        }
        // Containers without a peer expose their highest native descendant peers as roots.
        // Descendants of each peer come from GetChildren(), not a fabricated visual-tree mapping.
        FindRoots(root, 0);
        return roots;
    }
}
