# Supported framework API inventory — 0.14.0

Generated from the closed framework registry: **199 named types and 1744 ABI members**. Counts include task/thread/delegate/value/enum/helper types, not just controls. Inherited properties/events are expanded. This is a managed/browser compatibility profile, not the complete native WinUI or Windows App SDK API.

See [Edit and Continue / Designer](edit-continue-designer.md) and [advanced debugger / WinUI](advanced-debugging-winui.md) for behavior, deviations and qualification. In particular TargetTypeName, template VisualTree/Bind, string Date/Time and ContentDialog Show/Hide are profile contracts.

## Microsoft.UI.Xaml.Controls.Orientation

Kind: enum; base: System.Enum.

Enum values: Vertical=0, Horizontal=1.

## Microsoft.UI.Xaml.HorizontalAlignment

Kind: enum; base: System.Enum.

Enum values: Left=0, Center=1, Right=2, Stretch=3.

## Microsoft.UI.Xaml.VerticalAlignment

Kind: enum; base: System.Enum.

Enum values: Top=0, Center=1, Bottom=2, Stretch=3.

## Microsoft.UI.Xaml.Visibility

Kind: enum; base: System.Enum.

Enum values: Visible=0, Collapsed=1.

## Microsoft.UI.Xaml.ElementTheme

Kind: enum; base: System.Enum.

Enum values: Default=0, Light=1, Dark=2.

## Microsoft.UI.Xaml.GridUnitType

Kind: enum; base: System.Enum.

Enum values: Auto=0, Pixel=1, Star=2.

## Microsoft.UI.Xaml.TextWrapping

Kind: enum; base: System.Enum.

Enum values: NoWrap=0, Wrap=1, WrapWholeWords=2.

## Microsoft.UI.Xaml.TextAlignment

Kind: enum; base: System.Enum.

Enum values: Left=0, Center=1, Right=2, Justify=3, DetectFromContent=4.

## Microsoft.UI.Xaml.Controls.ScrollBarVisibility

Kind: enum; base: System.Enum.

Enum values: Disabled=0, Auto=1, Hidden=2, Visible=3.

## Microsoft.UI.Xaml.Thickness

Kind: value; base: System.ValueType.

### Properties

| Name | Type | Access |
|---|---|---|
| Left | double | get |
| Top | double | get |
| Right | double | get |
| Bottom | double | get |

### Declared methods

- `Microsoft.UI.Xaml.Thickness .ctor(double)`
- `Microsoft.UI.Xaml.Thickness .ctor(double, double, double, double)`

## Microsoft.UI.Xaml.CornerRadius

Kind: value; base: System.ValueType.

### Properties

| Name | Type | Access |
|---|---|---|
| TopLeft | double | get |
| TopRight | double | get |
| BottomRight | double | get |
| BottomLeft | double | get |

### Declared methods

- `Microsoft.UI.Xaml.CornerRadius .ctor(double)`
- `Microsoft.UI.Xaml.CornerRadius .ctor(double, double, double, double)`

## Microsoft.UI.Xaml.GridLength

Kind: value; base: System.ValueType.

### Properties

| Name | Type | Access |
|---|---|---|
| Value | double | get |
| GridUnitType | Microsoft.UI.Xaml.GridUnitType | get |
| Auto | Microsoft.UI.Xaml.GridLength | static get |

### Declared methods

- `Microsoft.UI.Xaml.GridLength .ctor(double)`
- `Microsoft.UI.Xaml.GridLength .ctor(double, Microsoft.UI.Xaml.GridUnitType)`

## Windows.UI.Color

Kind: value; base: System.ValueType.

### Properties

| Name | Type | Access |
|---|---|---|
| A | int | get |
| R | int | get |
| G | int | get |
| B | int | get |

### Declared methods

- `static Windows.UI.Color FromArgb(int, int, int, int)`

## Microsoft.UI.Colors

Kind: static; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Transparent | Windows.UI.Color | static get |
| Black | Windows.UI.Color | static get |
| White | Windows.UI.Color | static get |
| Red | Windows.UI.Color | static get |
| Green | Windows.UI.Color | static get |
| Blue | Windows.UI.Color | static get |
| Orange | Windows.UI.Color | static get |
| Gray | Windows.UI.Color | static get |
| LightGray | Windows.UI.Color | static get |
| DarkGray | Windows.UI.Color | static get |
| Purple | Windows.UI.Color | static get |
| Yellow | Windows.UI.Color | static get |
| CornflowerBlue | Windows.UI.Color | static get |
| DodgerBlue | Windows.UI.Color | static get |

## Microsoft.UI.Xaml.Media.Brush

Kind: abstract; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Opacity | double | get/set |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

## Microsoft.UI.Xaml.Media.SolidColorBrush

Kind: brush; base: Microsoft.UI.Xaml.Media.Brush.

### Properties

| Name | Type | Access |
|---|---|---|
| Opacity | double | get/set |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Color | Windows.UI.Color | get/set |

### Declared methods

- `Microsoft.UI.Xaml.Media.SolidColorBrush .ctor()`
- `Microsoft.UI.Xaml.Media.SolidColorBrush .ctor(Windows.UI.Color)`

## Microsoft.UI.Xaml.DependencyObject

Kind: object; base: object.

### Declared methods

- `object GetValue(Microsoft.UI.Xaml.DependencyProperty)`
- `void SetValue(Microsoft.UI.Xaml.DependencyProperty, object)`
- `void ClearValue(Microsoft.UI.Xaml.DependencyProperty)`
- `object ReadLocalValue(Microsoft.UI.Xaml.DependencyProperty)`

## Microsoft.UI.Xaml.UIElement

Kind: abstract; base: Microsoft.UI.Xaml.DependencyObject.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

## Microsoft.UI.Xaml.FrameworkElement

Kind: abstract; base: Microsoft.UI.Xaml.UIElement.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `object FindName(string)`
- `void add_Loaded(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_Loaded(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void add_Unloaded(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_Unloaded(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.RoutedEventHandler

Kind: delegate; base: System.MulticastDelegate.

### Declared methods

- `Microsoft.UI.Xaml.RoutedEventHandler .ctor(object, nint)`
- `void Invoke(object, Microsoft.UI.Xaml.RoutedEventArgs)`

## Microsoft.UI.Xaml.RoutedEventArgs

Kind: object; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| OriginalSource | object | get |
| Handled | bool | get/set |

## Microsoft.UI.Xaml.Controls.Control

Kind: abstract; base: Microsoft.UI.Xaml.FrameworkElement.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `bool Focus()`
- `bool ApplyTemplate()`
- `Microsoft.UI.Xaml.DependencyObject GetTemplateChild(string)`

## Microsoft.UI.Xaml.Controls.ContentControl

Kind: control; base: Microsoft.UI.Xaml.Controls.Control.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Content | object | get/set |
| ContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.ContentControl .ctor()`

## Microsoft.UI.Xaml.Controls.Page

Kind: control; base: Microsoft.UI.Xaml.Controls.ContentControl.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Content | object | get/set |
| ContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.Page .ctor()`

## Microsoft.UI.Xaml.Controls.UserControl

Kind: control; base: Microsoft.UI.Xaml.Controls.ContentControl.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Content | object | get/set |
| ContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.UserControl .ctor()`

## Microsoft.UI.Xaml.Controls.Button

Kind: control; base: Microsoft.UI.Xaml.Controls.ContentControl.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Content | object | get/set |
| ContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Flyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| FlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Click`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.Button .ctor()`
- `void add_Click(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_Click(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Controls.CheckBox

Kind: control; base: Microsoft.UI.Xaml.Controls.ContentControl.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Content | object | get/set |
| ContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsChecked | bool | get/set |
| IsCheckedProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Checked`, `Unchecked`, `Click`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.CheckBox .ctor()`
- `void add_Checked(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_Checked(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void add_Unchecked(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_Unchecked(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void add_Click(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_Click(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Controls.ToggleSwitch

Kind: control; base: Microsoft.UI.Xaml.Controls.Control.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Header | object | get/set |
| IsOn | bool | get/set |
| OnContent | object | get/set |
| OffContent | object | get/set |
| HeaderProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsOnProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OnContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OffContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Toggled`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.ToggleSwitch .ctor()`
- `void add_Toggled(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_Toggled(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Controls.TextBox

Kind: control; base: Microsoft.UI.Xaml.Controls.Control.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Text | string | get/set |
| PlaceholderText | string | get/set |
| Header | object | get/set |
| IsReadOnly | bool | get/set |
| AcceptsReturn | bool | get/set |
| MaxLength | int | get/set |
| TextWrapping | Microsoft.UI.Xaml.TextWrapping | get/set |
| TextProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PlaceholderTextProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeaderProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsReadOnlyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| AcceptsReturnProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxLengthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TextWrappingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `TextChanged`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.TextBox .ctor()`
- `void add_TextChanged(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_TextChanged(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Controls.PasswordBox

Kind: control; base: Microsoft.UI.Xaml.Controls.Control.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Password | string | get/set |
| PlaceholderText | string | get/set |
| Header | object | get/set |
| PasswordProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PlaceholderTextProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeaderProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `PasswordChanged`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.PasswordBox .ctor()`
- `void add_PasswordChanged(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_PasswordChanged(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Controls.TextBlock

Kind: control; base: Microsoft.UI.Xaml.FrameworkElement.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Text | string | get/set |
| FontSize | double | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| TextWrapping | Microsoft.UI.Xaml.TextWrapping | get/set |
| TextAlignment | Microsoft.UI.Xaml.TextAlignment | get/set |
| IsTextSelectionEnabled | bool | get/set |
| TextProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TextWrappingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TextAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTextSelectionEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.TextBlock .ctor()`

## Microsoft.UI.Xaml.Controls.Border

Kind: control; base: Microsoft.UI.Xaml.FrameworkElement.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Child | Microsoft.UI.Xaml.UIElement | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| ChildProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.Border .ctor()`

## Microsoft.UI.Xaml.Controls.Panel

Kind: control; base: Microsoft.UI.Xaml.FrameworkElement.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Children | Microsoft.UI.Xaml.Controls.UIElementCollection | get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.Panel .ctor()`

## Microsoft.UI.Xaml.Controls.StackPanel

Kind: control; base: Microsoft.UI.Xaml.Controls.Panel.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Children | Microsoft.UI.Xaml.Controls.UIElementCollection | get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Orientation | Microsoft.UI.Xaml.Controls.Orientation | get/set |
| Spacing | double | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| OrientationProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| SpacingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.StackPanel .ctor()`

## Microsoft.UI.Xaml.Controls.Grid

Kind: control; base: Microsoft.UI.Xaml.Controls.Panel.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Children | Microsoft.UI.Xaml.Controls.UIElementCollection | get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RowSpacing | double | get/set |
| ColumnSpacing | double | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| RowDefinitions | Microsoft.UI.Xaml.Controls.RowDefinitionCollection | get |
| ColumnDefinitions | Microsoft.UI.Xaml.Controls.ColumnDefinitionCollection | get |
| RowSpacingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ColumnSpacingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.Grid .ctor()`
- `static void SetRow(Microsoft.UI.Xaml.FrameworkElement, int)`
- `static int GetRow(Microsoft.UI.Xaml.FrameworkElement)`
- `static void SetColumn(Microsoft.UI.Xaml.FrameworkElement, int)`
- `static int GetColumn(Microsoft.UI.Xaml.FrameworkElement)`
- `static void SetRowSpan(Microsoft.UI.Xaml.FrameworkElement, int)`
- `static int GetRowSpan(Microsoft.UI.Xaml.FrameworkElement)`
- `static void SetColumnSpan(Microsoft.UI.Xaml.FrameworkElement, int)`
- `static int GetColumnSpan(Microsoft.UI.Xaml.FrameworkElement)`

## Microsoft.UI.Xaml.Controls.Canvas

Kind: control; base: Microsoft.UI.Xaml.Controls.Panel.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Children | Microsoft.UI.Xaml.Controls.UIElementCollection | get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.Canvas .ctor()`
- `static void SetLeft(Microsoft.UI.Xaml.UIElement, double)`
- `static double GetLeft(Microsoft.UI.Xaml.UIElement)`
- `static void SetTop(Microsoft.UI.Xaml.UIElement, double)`
- `static double GetTop(Microsoft.UI.Xaml.UIElement)`
- `static void SetZIndex(Microsoft.UI.Xaml.UIElement, int)`
- `static int GetZIndex(Microsoft.UI.Xaml.UIElement)`

## Microsoft.UI.Xaml.Controls.ScrollViewer

Kind: control; base: Microsoft.UI.Xaml.Controls.ContentControl.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Content | object | get/set |
| ContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalScrollBarVisibility | Microsoft.UI.Xaml.Controls.ScrollBarVisibility | get/set |
| VerticalScrollBarVisibility | Microsoft.UI.Xaml.Controls.ScrollBarVisibility | get/set |
| HorizontalScrollBarVisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalScrollBarVisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.ScrollViewer .ctor()`

## Microsoft.UI.Xaml.Controls.Slider

Kind: control; base: Microsoft.UI.Xaml.Controls.Control.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Minimum | double | get/set |
| Maximum | double | get/set |
| Value | double | get/set |
| StepFrequency | double | get/set |
| Header | object | get/set |
| Orientation | Microsoft.UI.Xaml.Controls.Orientation | get/set |
| MinimumProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaximumProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ValueProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StepFrequencyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeaderProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OrientationProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `ValueChanged`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.Slider .ctor()`
- `void add_ValueChanged(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_ValueChanged(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Controls.ProgressBar

Kind: control; base: Microsoft.UI.Xaml.Controls.Control.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Minimum | double | get/set |
| Maximum | double | get/set |
| Value | double | get/set |
| IsIndeterminate | bool | get/set |
| MinimumProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaximumProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ValueProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsIndeterminateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.ProgressBar .ctor()`

## Microsoft.UI.Xaml.Controls.ProgressRing

Kind: control; base: Microsoft.UI.Xaml.Controls.Control.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsActive | bool | get/set |
| IsIndeterminate | bool | get/set |
| Value | double | get/set |
| IsActiveProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsIndeterminateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ValueProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.ProgressRing .ctor()`

## Microsoft.UI.Xaml.Controls.ComboBox

Kind: control; base: Microsoft.UI.Xaml.Controls.Control.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Header | object | get/set |
| PlaceholderText | string | get/set |
| SelectedIndex | int | get/set |
| SelectedItem | object | get/set |
| Items | Microsoft.UI.Xaml.Controls.ItemCollection | get |
| HeaderProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PlaceholderTextProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| SelectedIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| SelectedItemProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `SelectionChanged`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.ComboBox .ctor()`
- `void add_SelectionChanged(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_SelectionChanged(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Controls.ListView

Kind: control; base: Microsoft.UI.Xaml.Controls.Control.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| SelectedIndex | int | get/set |
| SelectedItem | object | get/set |
| Items | Microsoft.UI.Xaml.Controls.ItemCollection | get |
| SelectedIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| SelectedItemProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `SelectionChanged`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.ListView .ctor()`
- `void add_SelectionChanged(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_SelectionChanged(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Controls.ComboBoxItem

Kind: control; base: Microsoft.UI.Xaml.Controls.ContentControl.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Content | object | get/set |
| ContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.ComboBoxItem .ctor()`

## Microsoft.UI.Xaml.Controls.ListViewItem

Kind: control; base: Microsoft.UI.Xaml.Controls.ContentControl.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Content | object | get/set |
| ContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.ListViewItem .ctor()`

## Microsoft.UI.Xaml.Controls.Image

Kind: control; base: Microsoft.UI.Xaml.FrameworkElement.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Source | string | get/set |
| AlternativeText | string | get/set |
| SourceProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| AlternativeTextProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.Image .ctor()`

## Microsoft.UI.Xaml.Controls.HyperlinkButton

Kind: control; base: Microsoft.UI.Xaml.Controls.ContentControl.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Content | object | get/set |
| ContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| NavigateUri | string | get/set |
| NavigateUriProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Click`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.HyperlinkButton .ctor()`
- `void add_Click(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_Click(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Controls.Expander

Kind: control; base: Microsoft.UI.Xaml.Controls.ContentControl.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Content | object | get/set |
| ContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Header | object | get/set |
| IsExpanded | bool | get/set |
| HeaderProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsExpandedProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Expanding`, `Collapsed`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.Expander .ctor()`
- `void add_Expanding(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_Expanding(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void add_Collapsed(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_Collapsed(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Controls.MenuFlyoutItem

Kind: control; base: Microsoft.UI.Xaml.Controls.Control.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Text | string | get/set |
| TextProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Click`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.MenuFlyoutItem .ctor()`
- `void add_Click(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_Click(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Controls.MenuFlyout

Kind: control; base: Microsoft.UI.Xaml.Controls.Control.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Items | Microsoft.UI.Xaml.Controls.ItemCollection | get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.MenuFlyout .ctor()`
- `void ShowAt(Microsoft.UI.Xaml.FrameworkElement)`
- `void Hide()`

## Microsoft.UI.Xaml.Controls.NavigationView

Kind: control; base: Microsoft.UI.Xaml.Controls.ContentControl.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Content | object | get/set |
| ContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Header | object | get/set |
| IsPaneOpen | bool | get/set |
| SelectedItem | object | get/set |
| MenuItems | Microsoft.UI.Xaml.Controls.ItemCollection | get |
| HeaderProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsPaneOpenProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| SelectedItemProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `SelectionChanged`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.NavigationView .ctor()`
- `void add_SelectionChanged(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_SelectionChanged(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Controls.NavigationViewItem

Kind: control; base: Microsoft.UI.Xaml.Controls.ContentControl.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Content | object | get/set |
| ContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.NavigationViewItem .ctor()`

## SharpForge.UI.DrawingSurface

Kind: control; base: Microsoft.UI.Xaml.FrameworkElement.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `SharpForge.UI.DrawingSurface .ctor()`
- `void Clear()`
- `void FillRectangle(double, double, double, double, Windows.UI.Color)`
- `void DrawLine(double, double, double, double, double, Windows.UI.Color)`

## Microsoft.UI.Xaml.Controls.UIElementCollection

Kind: collection; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |

### Declared methods

- `void Add(Microsoft.UI.Xaml.UIElement)`
- `void Clear()`
- `bool Remove(Microsoft.UI.Xaml.UIElement)`
- `void RemoveAt(int)`
- `void Insert(int, Microsoft.UI.Xaml.UIElement)`
- `Microsoft.UI.Xaml.UIElement get_Item(int)`

## Microsoft.UI.Xaml.Controls.ItemCollection

Kind: collection; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |

### Declared methods

- `void Add(object)`
- `void Clear()`
- `bool Remove(object)`
- `void RemoveAt(int)`
- `void Insert(int, object)`
- `object get_Item(int)`

## Microsoft.UI.Xaml.Controls.RowDefinitionCollection

Kind: collection; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |

### Declared methods

- `void Add(Microsoft.UI.Xaml.Controls.RowDefinition)`
- `void Clear()`
- `bool Remove(Microsoft.UI.Xaml.Controls.RowDefinition)`
- `void RemoveAt(int)`
- `void Insert(int, Microsoft.UI.Xaml.Controls.RowDefinition)`
- `Microsoft.UI.Xaml.Controls.RowDefinition get_Item(int)`

## Microsoft.UI.Xaml.Controls.ColumnDefinitionCollection

Kind: collection; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |

### Declared methods

- `void Add(Microsoft.UI.Xaml.Controls.ColumnDefinition)`
- `void Clear()`
- `bool Remove(Microsoft.UI.Xaml.Controls.ColumnDefinition)`
- `void RemoveAt(int)`
- `void Insert(int, Microsoft.UI.Xaml.Controls.ColumnDefinition)`
- `Microsoft.UI.Xaml.Controls.ColumnDefinition get_Item(int)`

## Microsoft.UI.Xaml.Controls.RowDefinition

Kind: control; base: Microsoft.UI.Xaml.DependencyObject.

### Properties

| Name | Type | Access |
|---|---|---|
| Height | Microsoft.UI.Xaml.GridLength | get/set |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

### Declared methods

- `Microsoft.UI.Xaml.Controls.RowDefinition .ctor()`

## Microsoft.UI.Xaml.Controls.ColumnDefinition

Kind: control; base: Microsoft.UI.Xaml.DependencyObject.

### Properties

| Name | Type | Access |
|---|---|---|
| Width | Microsoft.UI.Xaml.GridLength | get/set |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

### Declared methods

- `Microsoft.UI.Xaml.Controls.ColumnDefinition .ctor()`

## Microsoft.UI.Xaml.Window

Kind: window; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Content | Microsoft.UI.Xaml.UIElement | get/set |
| Title | string | get/set |

Events: `Closed`.

### Declared methods

- `Microsoft.UI.Xaml.Window .ctor()`
- `void Activate()`
- `void Close()`
- `void add_Closed(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_Closed(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Application

Kind: application; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Current | Microsoft.UI.Xaml.Application | static get |

### Declared methods

- `Microsoft.UI.Xaml.Application .ctor()`
- `void Exit()`

## SharpForge.Runtime.Async

Kind: static; base: object.

### Declared methods

- `static void Await(System.Threading.Tasks.Task)`
- `static System.Threading.Tasks.Task Start(System.Action)`
- `static int Await(System.Threading.Tasks.Task`1<int>)`
- `static System.Threading.Tasks.Task`1<int> Start(System.Func`1<int>)`
- `static double Await(System.Threading.Tasks.Task`1<double>)`
- `static System.Threading.Tasks.Task`1<double> Start(System.Func`1<double>)`
- `static bool Await(System.Threading.Tasks.Task`1<bool>)`
- `static System.Threading.Tasks.Task`1<bool> Start(System.Func`1<bool>)`
- `static string Await(System.Threading.Tasks.Task`1<string>)`
- `static System.Threading.Tasks.Task`1<string> Start(System.Func`1<string>)`
- `static object Await(System.Threading.Tasks.Task`1<object>)`
- `static System.Threading.Tasks.Task`1<object> Start(System.Func`1<object>)`
- `static System.Net.Http.HttpResponseMessage Await(System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage>)`
- `static System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> Start(System.Func`1<System.Net.Http.HttpResponseMessage>)`
- `static double[] Await(System.Threading.Tasks.Task`1<double[]>)`
- `static System.Threading.Tasks.Task`1<double[]> Start(System.Func`1<double[]>)`

## System.Action

Kind: delegate; base: System.MulticastDelegate.

### Declared methods

- `System.Action .ctor(object, nint)`
- `void Invoke()`

## System.Func`1<int>

Kind: delegate; base: System.MulticastDelegate.

### Declared methods

- `System.Func`1<int> .ctor(object, nint)`
- `int Invoke()`

## System.Func`1<double>

Kind: delegate; base: System.MulticastDelegate.

### Declared methods

- `System.Func`1<double> .ctor(object, nint)`
- `double Invoke()`

## System.Func`1<bool>

Kind: delegate; base: System.MulticastDelegate.

### Declared methods

- `System.Func`1<bool> .ctor(object, nint)`
- `bool Invoke()`

## System.Func`1<string>

Kind: delegate; base: System.MulticastDelegate.

### Declared methods

- `System.Func`1<string> .ctor(object, nint)`
- `string Invoke()`

## System.Func`1<object>

Kind: delegate; base: System.MulticastDelegate.

### Declared methods

- `System.Func`1<object> .ctor(object, nint)`
- `object Invoke()`

## System.Threading.ThreadStart

Kind: delegate; base: System.MulticastDelegate.

### Declared methods

- `System.Threading.ThreadStart .ctor(object, nint)`
- `void Invoke()`

## System.Threading.Thread

Kind: thread; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Name | string | get/set |
| ManagedThreadId | int | get |
| IsAlive | bool | get |
| CurrentThread | System.Threading.Thread | static get |

### Declared methods

- `System.Threading.Thread .ctor(System.Threading.ThreadStart)`
- `void Start()`
- `void Join()`
- `static void Sleep(int)`
- `static bool Yield()`

## System.Threading.Tasks.Task

Kind: task; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Id | int | get |
| IsCompleted | bool | get |
| IsFaulted | bool | get |
| IsCanceled | bool | get |
| CompletedTask | System.Threading.Tasks.Task | static get |

### Declared methods

- `void Wait()`
- `static System.Threading.Tasks.Task Delay(int)`
- `static System.Threading.Tasks.Task Yield()`
- `static System.Threading.Tasks.Task Run(System.Action)`
- `static System.Threading.Tasks.Task`1<int> Run(System.Func`1<int>)`
- `static System.Threading.Tasks.Task`1<double> Run(System.Func`1<double>)`
- `static System.Threading.Tasks.Task`1<bool> Run(System.Func`1<bool>)`
- `static System.Threading.Tasks.Task`1<string> Run(System.Func`1<string>)`
- `static System.Threading.Tasks.Task`1<object> Run(System.Func`1<object>)`
- `static System.Threading.Tasks.Task WhenAll(System.Threading.Tasks.Task[])`
- `static System.Threading.Tasks.Task`1<object> WhenAny(System.Threading.Tasks.Task[])`
- `static System.Threading.Tasks.Task`1<int> FromResult(int)`
- `static System.Threading.Tasks.Task`1<string> FromResult(string)`

## System.Threading.Tasks.Task`1<int>

Kind: task; base: System.Threading.Tasks.Task.

### Properties

| Name | Type | Access |
|---|---|---|
| Id | int | get |
| IsCompleted | bool | get |
| IsFaulted | bool | get |
| IsCanceled | bool | get |
| CompletedTask | System.Threading.Tasks.Task | static get |
| Result | int | get |

### Declared methods

- `void Wait()`

## System.Threading.Tasks.Task`1<double>

Kind: task; base: System.Threading.Tasks.Task.

### Properties

| Name | Type | Access |
|---|---|---|
| Id | int | get |
| IsCompleted | bool | get |
| IsFaulted | bool | get |
| IsCanceled | bool | get |
| CompletedTask | System.Threading.Tasks.Task | static get |
| Result | double | get |

### Declared methods

- `void Wait()`

## System.Threading.Tasks.Task`1<bool>

Kind: task; base: System.Threading.Tasks.Task.

### Properties

| Name | Type | Access |
|---|---|---|
| Id | int | get |
| IsCompleted | bool | get |
| IsFaulted | bool | get |
| IsCanceled | bool | get |
| CompletedTask | System.Threading.Tasks.Task | static get |
| Result | bool | get |

### Declared methods

- `void Wait()`

## System.Threading.Tasks.Task`1<string>

Kind: task; base: System.Threading.Tasks.Task.

### Properties

| Name | Type | Access |
|---|---|---|
| Id | int | get |
| IsCompleted | bool | get |
| IsFaulted | bool | get |
| IsCanceled | bool | get |
| CompletedTask | System.Threading.Tasks.Task | static get |
| Result | string | get |

### Declared methods

- `void Wait()`

## System.Threading.Tasks.Task`1<object>

Kind: task; base: System.Threading.Tasks.Task.

### Properties

| Name | Type | Access |
|---|---|---|
| Id | int | get |
| IsCompleted | bool | get |
| IsFaulted | bool | get |
| IsCanceled | bool | get |
| CompletedTask | System.Threading.Tasks.Task | static get |
| Result | object | get |

### Declared methods

- `void Wait()`

## Microsoft.UI.Xaml.Shapes.Shape

Kind: abstract; base: Microsoft.UI.Xaml.FrameworkElement.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Fill | Microsoft.UI.Xaml.Media.Brush | get/set |
| Stroke | Microsoft.UI.Xaml.Media.Brush | get/set |
| StrokeThickness | double | get/set |
| FillProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StrokeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StrokeThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

## Microsoft.UI.Xaml.Shapes.Rectangle

Kind: shape; base: Microsoft.UI.Xaml.Shapes.Shape.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Fill | Microsoft.UI.Xaml.Media.Brush | get/set |
| Stroke | Microsoft.UI.Xaml.Media.Brush | get/set |
| StrokeThickness | double | get/set |
| FillProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StrokeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StrokeThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RadiusX | double | get/set |
| RadiusY | double | get/set |
| RadiusXProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RadiusYProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Shapes.Rectangle .ctor()`

## Microsoft.UI.Xaml.Shapes.Ellipse

Kind: shape; base: Microsoft.UI.Xaml.Shapes.Shape.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Fill | Microsoft.UI.Xaml.Media.Brush | get/set |
| Stroke | Microsoft.UI.Xaml.Media.Brush | get/set |
| StrokeThickness | double | get/set |
| FillProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StrokeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StrokeThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Shapes.Ellipse .ctor()`

## Microsoft.UI.Xaml.Shapes.Line

Kind: shape; base: Microsoft.UI.Xaml.Shapes.Shape.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Fill | Microsoft.UI.Xaml.Media.Brush | get/set |
| Stroke | Microsoft.UI.Xaml.Media.Brush | get/set |
| StrokeThickness | double | get/set |
| FillProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StrokeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StrokeThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| X1 | double | get/set |
| Y1 | double | get/set |
| X2 | double | get/set |
| Y2 | double | get/set |
| X1Property | Microsoft.UI.Xaml.DependencyProperty | static get |
| Y1Property | Microsoft.UI.Xaml.DependencyProperty | static get |
| X2Property | Microsoft.UI.Xaml.DependencyProperty | static get |
| Y2Property | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Shapes.Line .ctor()`

## Microsoft.UI.Xaml.Controls.ToggleButton

Kind: control; base: Microsoft.UI.Xaml.Controls.ContentControl.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Content | object | get/set |
| ContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsChecked | bool | get/set |
| IsCheckedProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Click`, `Checked`, `Unchecked`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.ToggleButton .ctor()`
- `void add_Click(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_Click(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void add_Checked(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_Checked(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void add_Unchecked(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_Unchecked(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Controls.RadioButton

Kind: control; base: Microsoft.UI.Xaml.Controls.ContentControl.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Content | object | get/set |
| ContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsChecked | bool | get/set |
| GroupName | string | get/set |
| IsCheckedProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| GroupNameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Checked`, `Unchecked`, `Click`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.RadioButton .ctor()`
- `void add_Checked(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_Checked(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void add_Unchecked(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_Unchecked(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void add_Click(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_Click(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Controls.NumberBox

Kind: control; base: Microsoft.UI.Xaml.Controls.Control.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Value | double | get/set |
| Minimum | double | get/set |
| Maximum | double | get/set |
| SmallChange | double | get/set |
| Header | object | get/set |
| PlaceholderText | string | get/set |
| IsReadOnly | bool | get/set |
| ValueProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinimumProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaximumProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| SmallChangeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeaderProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PlaceholderTextProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsReadOnlyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `ValueChanged`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.NumberBox .ctor()`
- `void add_ValueChanged(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_ValueChanged(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Controls.AutoSuggestBox

Kind: control; base: Microsoft.UI.Xaml.Controls.TextBox.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Text | string | get/set |
| PlaceholderText | string | get/set |
| Header | object | get/set |
| IsReadOnly | bool | get/set |
| AcceptsReturn | bool | get/set |
| MaxLength | int | get/set |
| TextWrapping | Microsoft.UI.Xaml.TextWrapping | get/set |
| TextProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PlaceholderTextProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeaderProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsReadOnlyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| AcceptsReturnProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxLengthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TextWrappingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `QuerySubmitted`, `TextChanged`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.AutoSuggestBox .ctor()`
- `void add_QuerySubmitted(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_QuerySubmitted(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Controls.CalendarDatePicker

Kind: control; base: Microsoft.UI.Xaml.Controls.Control.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Date | string | get/set |
| PlaceholderText | string | get/set |
| Header | object | get/set |
| DateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PlaceholderTextProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeaderProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `DateChanged`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.CalendarDatePicker .ctor()`
- `void add_DateChanged(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_DateChanged(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Controls.TimePicker

Kind: control; base: Microsoft.UI.Xaml.Controls.Control.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Time | string | get/set |
| Header | object | get/set |
| TimeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeaderProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `TimeChanged`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.TimePicker .ctor()`
- `void add_TimeChanged(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_TimeChanged(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Controls.InfoBar

Kind: control; base: Microsoft.UI.Xaml.Controls.ContentControl.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Content | object | get/set |
| ContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Title | string | get/set |
| Message | string | get/set |
| IsOpen | bool | get/set |
| IsClosable | bool | get/set |
| Severity | int | get/set |
| TitleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MessageProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsOpenProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsClosableProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| SeverityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Closed`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.InfoBar .ctor()`
- `void add_Closed(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_Closed(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Controls.ContentPresenter

Kind: control; base: Microsoft.UI.Xaml.Controls.ContentControl.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Content | object | get/set |
| ContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.ContentPresenter .ctor()`

## Microsoft.UI.Xaml.Media.Stretch

Kind: enum; base: System.Enum.

Enum values: None=0, Fill=1, Uniform=2, UniformToFill=3.

## Microsoft.UI.Xaml.Controls.Viewbox

Kind: control; base: Microsoft.UI.Xaml.Controls.ContentControl.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Content | object | get/set |
| ContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Stretch | Microsoft.UI.Xaml.Media.Stretch | get/set |
| StretchProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.Viewbox .ctor()`

## Microsoft.UI.Xaml.Controls.TabView

Kind: control; base: Microsoft.UI.Xaml.Controls.Control.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| SelectedIndex | int | get/set |
| TabItems | Microsoft.UI.Xaml.Controls.ItemCollection | get |
| SelectedIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `SelectionChanged`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.TabView .ctor()`
- `void add_SelectionChanged(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_SelectionChanged(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Controls.TabViewItem

Kind: control; base: Microsoft.UI.Xaml.Controls.ContentControl.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Content | object | get/set |
| ContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Header | object | get/set |
| IsClosable | bool | get/set |
| HeaderProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsClosableProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `CloseRequested`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.TabViewItem .ctor()`
- `void add_CloseRequested(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_CloseRequested(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Controls.AppBarButton

Kind: control; base: Microsoft.UI.Xaml.Controls.Button.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Content | object | get/set |
| ContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Flyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| FlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Label | string | get/set |
| LabelProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Click`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.AppBarButton .ctor()`

## Microsoft.UI.Xaml.Controls.CommandBar

Kind: control; base: Microsoft.UI.Xaml.Controls.Panel.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Children | Microsoft.UI.Xaml.Controls.UIElementCollection | get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.CommandBar .ctor()`

## Microsoft.UI.Xaml.Controls.ToolTip

Kind: control; base: Microsoft.UI.Xaml.Controls.ContentControl.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Content | object | get/set |
| ContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsOpen | bool | get/set |
| IsOpenProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.ToolTip .ctor()`

## Microsoft.UI.Xaml.Controls.ContentDialog

Kind: control; base: Microsoft.UI.Xaml.Controls.ContentControl.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsEnabled | bool | get/set |
| TabIndex | int | get/set |
| IsTabStop | bool | get/set |
| FontSize | double | get/set |
| FontFamily | string | get/set |
| Foreground | Microsoft.UI.Xaml.Media.Brush | get/set |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Padding | Microsoft.UI.Xaml.Thickness | get/set |
| BorderBrush | Microsoft.UI.Xaml.Media.Brush | get/set |
| BorderThickness | Microsoft.UI.Xaml.Thickness | get/set |
| CornerRadius | Microsoft.UI.Xaml.CornerRadius | get/set |
| Template | Microsoft.UI.Xaml.Controls.ControlTemplate | get/set |
| IsEnabledProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TabIndexProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsTabStopProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontSizeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FontFamilyProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ForegroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PaddingProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderBrushProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BorderThicknessProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CornerRadiusProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TemplateProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Content | object | get/set |
| ContentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Title | object | get/set |
| PrimaryButtonText | string | get/set |
| SecondaryButtonText | string | get/set |
| CloseButtonText | string | get/set |
| IsOpen | bool | get/set |
| TitleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| PrimaryButtonTextProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| SecondaryButtonTextProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CloseButtonTextProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsOpenProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `PrimaryButtonClick`, `SecondaryButtonClick`, `CloseButtonClick`, `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.ContentDialog .ctor()`
- `void add_PrimaryButtonClick(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_PrimaryButtonClick(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void add_SecondaryButtonClick(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_SecondaryButtonClick(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void add_CloseButtonClick(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_CloseButtonClick(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void Show()`
- `void Hide()`

## Microsoft.UI.Xaml.Controls.Separator

Kind: control; base: Microsoft.UI.Xaml.FrameworkElement.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.Separator .ctor()`

## Microsoft.UI.Xaml.DependencyProperty

Kind: dependencyProperty; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Name | string | get |
| UnsetValue | object | static get |

## Microsoft.UI.Xaml.Setter

Kind: setter; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Property | Microsoft.UI.Xaml.DependencyProperty | get/set |
| Value | object | get/set |

### Declared methods

- `Microsoft.UI.Xaml.Setter .ctor()`
- `Microsoft.UI.Xaml.Setter .ctor(Microsoft.UI.Xaml.DependencyProperty, object)`

## Microsoft.UI.Xaml.SetterBaseCollection

Kind: collection; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |

### Declared methods

- `void Add(Microsoft.UI.Xaml.Setter)`
- `void Clear()`
- `bool Remove(Microsoft.UI.Xaml.Setter)`
- `void RemoveAt(int)`
- `void Insert(int, Microsoft.UI.Xaml.Setter)`
- `Microsoft.UI.Xaml.Setter get_Item(int)`

## Microsoft.UI.Xaml.Style

Kind: style; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| TargetTypeName | string | get/set |
| BasedOn | Microsoft.UI.Xaml.Style | get/set |
| Setters | Microsoft.UI.Xaml.SetterBaseCollection | get |

### Declared methods

- `Microsoft.UI.Xaml.Style .ctor()`
- `Microsoft.UI.Xaml.Style .ctor(string)`

## Microsoft.UI.Xaml.Controls.ControlTemplate

Kind: template; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| TargetTypeName | string | get/set |
| VisualTree | Microsoft.UI.Xaml.UIElement | get/set |

### Declared methods

- `Microsoft.UI.Xaml.Controls.ControlTemplate .ctor()`
- `void Bind(Microsoft.UI.Xaml.FrameworkElement, string, Microsoft.UI.Xaml.DependencyProperty)`

## System.Text.StringBuilder

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Length | int | get/set |
| Capacity | int | get/set |
| MaxCapacity | int | get |

### Declared methods

- `System.Text.StringBuilder .ctor()`
- `System.Text.StringBuilder .ctor(int)`
- `System.Text.StringBuilder .ctor(string)`
- `System.Text.StringBuilder .ctor(string, int)`
- `System.Text.StringBuilder Append(int)`
- `System.Text.StringBuilder Append(double)`
- `System.Text.StringBuilder Append(bool)`
- `System.Text.StringBuilder Append(string)`
- `System.Text.StringBuilder Append(object)`
- `System.Text.StringBuilder AppendLine()`
- `System.Text.StringBuilder AppendLine(string)`
- `System.Text.StringBuilder Clear()`
- `string ToString()`
- `string ToString(int, int)`
- `System.Text.StringBuilder Insert(int, string)`
- `System.Text.StringBuilder Remove(int, int)`
- `System.Text.StringBuilder Replace(string, string)`
- `int EnsureCapacity(int)`
- `System.Text.StringBuilder AppendFormat(string, object)`
- `System.Text.StringBuilder AppendFormat(string, object, object)`
- `System.Text.StringBuilder AppendFormat(string, object, object, object)`

## SharpForge.Runtime.Enumerator`1<int>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Current | int | get |

### Declared methods

- `bool MoveNext()`
- `void Dispose()`

## System.Collections.Generic.List`1<int>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |
| Capacity | int | get/set |

### Declared methods

- `System.Collections.Generic.List`1<int> .ctor()`
- `System.Collections.Generic.List`1<int> .ctor(int)`
- `System.Collections.Generic.List`1<int> .ctor(int[])`
- `void Clear()`
- `bool Contains(int)`
- `int[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<int> GetEnumerator()`
- `void Add(int)`
- `void AddRange(int[])`
- `void Insert(int, int)`
- `bool Remove(int)`
- `void RemoveAt(int)`
- `void RemoveRange(int, int)`
- `int IndexOf(int)`
- `int get_Item(int)`
- `void set_Item(int, int)`
- `void Reverse()`
- `void Sort()`

## System.Collections.Generic.HashSet`1<int>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |

### Declared methods

- `System.Collections.Generic.HashSet`1<int> .ctor()`
- `System.Collections.Generic.HashSet`1<int> .ctor(int)`
- `System.Collections.Generic.HashSet`1<int> .ctor(int[])`
- `void Clear()`
- `bool Contains(int)`
- `int[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<int> GetEnumerator()`
- `bool Add(int)`
- `bool Remove(int)`
- `void UnionWith(int[])`
- `void IntersectWith(int[])`
- `void ExceptWith(int[])`

## System.Collections.Generic.Queue`1<int>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |

### Declared methods

- `System.Collections.Generic.Queue`1<int> .ctor()`
- `System.Collections.Generic.Queue`1<int> .ctor(int)`
- `System.Collections.Generic.Queue`1<int> .ctor(int[])`
- `void Clear()`
- `bool Contains(int)`
- `int[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<int> GetEnumerator()`
- `void Enqueue(int)`
- `int Dequeue()`
- `int Peek()`

## System.Collections.Generic.Stack`1<int>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |

### Declared methods

- `System.Collections.Generic.Stack`1<int> .ctor()`
- `System.Collections.Generic.Stack`1<int> .ctor(int)`
- `System.Collections.Generic.Stack`1<int> .ctor(int[])`
- `void Clear()`
- `bool Contains(int)`
- `int[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<int> GetEnumerator()`
- `void Push(int)`
- `int Pop()`
- `int Peek()`

## System.Collections.Generic.Dictionary`2<string, int>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |
| Keys | string[] | get |
| Values | int[] | get |

### Declared methods

- `System.Collections.Generic.Dictionary`2<string, int> .ctor()`
- `System.Collections.Generic.Dictionary`2<string, int> .ctor(int)`
- `void Add(string, int)`
- `bool TryAdd(string, int)`
- `bool ContainsKey(string)`
- `bool ContainsValue(int)`
- `bool Remove(string)`
- `void Clear()`
- `int get_Item(string)`
- `void set_Item(string, int)`

## System.Collections.Generic.Dictionary`2<int, int>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |
| Keys | int[] | get |
| Values | int[] | get |

### Declared methods

- `System.Collections.Generic.Dictionary`2<int, int> .ctor()`
- `System.Collections.Generic.Dictionary`2<int, int> .ctor(int)`
- `void Add(int, int)`
- `bool TryAdd(int, int)`
- `bool ContainsKey(int)`
- `bool ContainsValue(int)`
- `bool Remove(int)`
- `void Clear()`
- `int get_Item(int)`
- `void set_Item(int, int)`

## SharpForge.Runtime.Enumerator`1<double>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Current | double | get |

### Declared methods

- `bool MoveNext()`
- `void Dispose()`

## System.Collections.Generic.List`1<double>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |
| Capacity | int | get/set |

### Declared methods

- `System.Collections.Generic.List`1<double> .ctor()`
- `System.Collections.Generic.List`1<double> .ctor(int)`
- `System.Collections.Generic.List`1<double> .ctor(double[])`
- `void Clear()`
- `bool Contains(double)`
- `double[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<double> GetEnumerator()`
- `void Add(double)`
- `void AddRange(double[])`
- `void Insert(int, double)`
- `bool Remove(double)`
- `void RemoveAt(int)`
- `void RemoveRange(int, int)`
- `int IndexOf(double)`
- `double get_Item(int)`
- `void set_Item(int, double)`
- `void Reverse()`
- `void Sort()`

## System.Collections.Generic.HashSet`1<double>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |

### Declared methods

- `System.Collections.Generic.HashSet`1<double> .ctor()`
- `System.Collections.Generic.HashSet`1<double> .ctor(int)`
- `System.Collections.Generic.HashSet`1<double> .ctor(double[])`
- `void Clear()`
- `bool Contains(double)`
- `double[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<double> GetEnumerator()`
- `bool Add(double)`
- `bool Remove(double)`
- `void UnionWith(double[])`
- `void IntersectWith(double[])`
- `void ExceptWith(double[])`

## System.Collections.Generic.Queue`1<double>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |

### Declared methods

- `System.Collections.Generic.Queue`1<double> .ctor()`
- `System.Collections.Generic.Queue`1<double> .ctor(int)`
- `System.Collections.Generic.Queue`1<double> .ctor(double[])`
- `void Clear()`
- `bool Contains(double)`
- `double[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<double> GetEnumerator()`
- `void Enqueue(double)`
- `double Dequeue()`
- `double Peek()`

## System.Collections.Generic.Stack`1<double>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |

### Declared methods

- `System.Collections.Generic.Stack`1<double> .ctor()`
- `System.Collections.Generic.Stack`1<double> .ctor(int)`
- `System.Collections.Generic.Stack`1<double> .ctor(double[])`
- `void Clear()`
- `bool Contains(double)`
- `double[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<double> GetEnumerator()`
- `void Push(double)`
- `double Pop()`
- `double Peek()`

## System.Collections.Generic.Dictionary`2<string, double>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |
| Keys | string[] | get |
| Values | double[] | get |

### Declared methods

- `System.Collections.Generic.Dictionary`2<string, double> .ctor()`
- `System.Collections.Generic.Dictionary`2<string, double> .ctor(int)`
- `void Add(string, double)`
- `bool TryAdd(string, double)`
- `bool ContainsKey(string)`
- `bool ContainsValue(double)`
- `bool Remove(string)`
- `void Clear()`
- `double get_Item(string)`
- `void set_Item(string, double)`

## System.Collections.Generic.Dictionary`2<int, double>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |
| Keys | int[] | get |
| Values | double[] | get |

### Declared methods

- `System.Collections.Generic.Dictionary`2<int, double> .ctor()`
- `System.Collections.Generic.Dictionary`2<int, double> .ctor(int)`
- `void Add(int, double)`
- `bool TryAdd(int, double)`
- `bool ContainsKey(int)`
- `bool ContainsValue(double)`
- `bool Remove(int)`
- `void Clear()`
- `double get_Item(int)`
- `void set_Item(int, double)`

## SharpForge.Runtime.Enumerator`1<bool>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Current | bool | get |

### Declared methods

- `bool MoveNext()`
- `void Dispose()`

## System.Collections.Generic.List`1<bool>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |
| Capacity | int | get/set |

### Declared methods

- `System.Collections.Generic.List`1<bool> .ctor()`
- `System.Collections.Generic.List`1<bool> .ctor(int)`
- `System.Collections.Generic.List`1<bool> .ctor(bool[])`
- `void Clear()`
- `bool Contains(bool)`
- `bool[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<bool> GetEnumerator()`
- `void Add(bool)`
- `void AddRange(bool[])`
- `void Insert(int, bool)`
- `bool Remove(bool)`
- `void RemoveAt(int)`
- `void RemoveRange(int, int)`
- `int IndexOf(bool)`
- `bool get_Item(int)`
- `void set_Item(int, bool)`
- `void Reverse()`
- `void Sort()`

## System.Collections.Generic.HashSet`1<bool>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |

### Declared methods

- `System.Collections.Generic.HashSet`1<bool> .ctor()`
- `System.Collections.Generic.HashSet`1<bool> .ctor(int)`
- `System.Collections.Generic.HashSet`1<bool> .ctor(bool[])`
- `void Clear()`
- `bool Contains(bool)`
- `bool[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<bool> GetEnumerator()`
- `bool Add(bool)`
- `bool Remove(bool)`
- `void UnionWith(bool[])`
- `void IntersectWith(bool[])`
- `void ExceptWith(bool[])`

## System.Collections.Generic.Queue`1<bool>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |

### Declared methods

- `System.Collections.Generic.Queue`1<bool> .ctor()`
- `System.Collections.Generic.Queue`1<bool> .ctor(int)`
- `System.Collections.Generic.Queue`1<bool> .ctor(bool[])`
- `void Clear()`
- `bool Contains(bool)`
- `bool[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<bool> GetEnumerator()`
- `void Enqueue(bool)`
- `bool Dequeue()`
- `bool Peek()`

## System.Collections.Generic.Stack`1<bool>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |

### Declared methods

- `System.Collections.Generic.Stack`1<bool> .ctor()`
- `System.Collections.Generic.Stack`1<bool> .ctor(int)`
- `System.Collections.Generic.Stack`1<bool> .ctor(bool[])`
- `void Clear()`
- `bool Contains(bool)`
- `bool[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<bool> GetEnumerator()`
- `void Push(bool)`
- `bool Pop()`
- `bool Peek()`

## System.Collections.Generic.Dictionary`2<string, bool>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |
| Keys | string[] | get |
| Values | bool[] | get |

### Declared methods

- `System.Collections.Generic.Dictionary`2<string, bool> .ctor()`
- `System.Collections.Generic.Dictionary`2<string, bool> .ctor(int)`
- `void Add(string, bool)`
- `bool TryAdd(string, bool)`
- `bool ContainsKey(string)`
- `bool ContainsValue(bool)`
- `bool Remove(string)`
- `void Clear()`
- `bool get_Item(string)`
- `void set_Item(string, bool)`

## System.Collections.Generic.Dictionary`2<int, bool>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |
| Keys | int[] | get |
| Values | bool[] | get |

### Declared methods

- `System.Collections.Generic.Dictionary`2<int, bool> .ctor()`
- `System.Collections.Generic.Dictionary`2<int, bool> .ctor(int)`
- `void Add(int, bool)`
- `bool TryAdd(int, bool)`
- `bool ContainsKey(int)`
- `bool ContainsValue(bool)`
- `bool Remove(int)`
- `void Clear()`
- `bool get_Item(int)`
- `void set_Item(int, bool)`

## SharpForge.Runtime.Enumerator`1<string>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Current | string | get |

### Declared methods

- `bool MoveNext()`
- `void Dispose()`

## System.Collections.Generic.List`1<string>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |
| Capacity | int | get/set |

### Declared methods

- `System.Collections.Generic.List`1<string> .ctor()`
- `System.Collections.Generic.List`1<string> .ctor(int)`
- `System.Collections.Generic.List`1<string> .ctor(string[])`
- `void Clear()`
- `bool Contains(string)`
- `string[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<string> GetEnumerator()`
- `void Add(string)`
- `void AddRange(string[])`
- `void Insert(int, string)`
- `bool Remove(string)`
- `void RemoveAt(int)`
- `void RemoveRange(int, int)`
- `int IndexOf(string)`
- `string get_Item(int)`
- `void set_Item(int, string)`
- `void Reverse()`
- `void Sort()`

## System.Collections.Generic.HashSet`1<string>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |

### Declared methods

- `System.Collections.Generic.HashSet`1<string> .ctor()`
- `System.Collections.Generic.HashSet`1<string> .ctor(int)`
- `System.Collections.Generic.HashSet`1<string> .ctor(string[])`
- `void Clear()`
- `bool Contains(string)`
- `string[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<string> GetEnumerator()`
- `bool Add(string)`
- `bool Remove(string)`
- `void UnionWith(string[])`
- `void IntersectWith(string[])`
- `void ExceptWith(string[])`

## System.Collections.Generic.Queue`1<string>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |

### Declared methods

- `System.Collections.Generic.Queue`1<string> .ctor()`
- `System.Collections.Generic.Queue`1<string> .ctor(int)`
- `System.Collections.Generic.Queue`1<string> .ctor(string[])`
- `void Clear()`
- `bool Contains(string)`
- `string[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<string> GetEnumerator()`
- `void Enqueue(string)`
- `string Dequeue()`
- `string Peek()`

## System.Collections.Generic.Stack`1<string>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |

### Declared methods

- `System.Collections.Generic.Stack`1<string> .ctor()`
- `System.Collections.Generic.Stack`1<string> .ctor(int)`
- `System.Collections.Generic.Stack`1<string> .ctor(string[])`
- `void Clear()`
- `bool Contains(string)`
- `string[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<string> GetEnumerator()`
- `void Push(string)`
- `string Pop()`
- `string Peek()`

## System.Collections.Generic.Dictionary`2<string, string>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |
| Keys | string[] | get |
| Values | string[] | get |

### Declared methods

- `System.Collections.Generic.Dictionary`2<string, string> .ctor()`
- `System.Collections.Generic.Dictionary`2<string, string> .ctor(int)`
- `void Add(string, string)`
- `bool TryAdd(string, string)`
- `bool ContainsKey(string)`
- `bool ContainsValue(string)`
- `bool Remove(string)`
- `void Clear()`
- `string get_Item(string)`
- `void set_Item(string, string)`

## System.Collections.Generic.Dictionary`2<int, string>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |
| Keys | int[] | get |
| Values | string[] | get |

### Declared methods

- `System.Collections.Generic.Dictionary`2<int, string> .ctor()`
- `System.Collections.Generic.Dictionary`2<int, string> .ctor(int)`
- `void Add(int, string)`
- `bool TryAdd(int, string)`
- `bool ContainsKey(int)`
- `bool ContainsValue(string)`
- `bool Remove(int)`
- `void Clear()`
- `string get_Item(int)`
- `void set_Item(int, string)`

## SharpForge.Runtime.Enumerator`1<object>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Current | object | get |

### Declared methods

- `bool MoveNext()`
- `void Dispose()`

## System.Collections.Generic.List`1<object>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |
| Capacity | int | get/set |

### Declared methods

- `System.Collections.Generic.List`1<object> .ctor()`
- `System.Collections.Generic.List`1<object> .ctor(int)`
- `System.Collections.Generic.List`1<object> .ctor(object[])`
- `void Clear()`
- `bool Contains(object)`
- `object[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<object> GetEnumerator()`
- `void Add(object)`
- `void AddRange(object[])`
- `void Insert(int, object)`
- `bool Remove(object)`
- `void RemoveAt(int)`
- `void RemoveRange(int, int)`
- `int IndexOf(object)`
- `object get_Item(int)`
- `void set_Item(int, object)`
- `void Reverse()`
- `void Sort()`

## System.Collections.Generic.HashSet`1<object>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |

### Declared methods

- `System.Collections.Generic.HashSet`1<object> .ctor()`
- `System.Collections.Generic.HashSet`1<object> .ctor(int)`
- `System.Collections.Generic.HashSet`1<object> .ctor(object[])`
- `void Clear()`
- `bool Contains(object)`
- `object[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<object> GetEnumerator()`
- `bool Add(object)`
- `bool Remove(object)`
- `void UnionWith(object[])`
- `void IntersectWith(object[])`
- `void ExceptWith(object[])`

## System.Collections.Generic.Queue`1<object>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |

### Declared methods

- `System.Collections.Generic.Queue`1<object> .ctor()`
- `System.Collections.Generic.Queue`1<object> .ctor(int)`
- `System.Collections.Generic.Queue`1<object> .ctor(object[])`
- `void Clear()`
- `bool Contains(object)`
- `object[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<object> GetEnumerator()`
- `void Enqueue(object)`
- `object Dequeue()`
- `object Peek()`

## System.Collections.Generic.Stack`1<object>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |

### Declared methods

- `System.Collections.Generic.Stack`1<object> .ctor()`
- `System.Collections.Generic.Stack`1<object> .ctor(int)`
- `System.Collections.Generic.Stack`1<object> .ctor(object[])`
- `void Clear()`
- `bool Contains(object)`
- `object[] ToArray()`
- `SharpForge.Runtime.Enumerator`1<object> GetEnumerator()`
- `void Push(object)`
- `object Pop()`
- `object Peek()`

## System.Collections.Generic.Dictionary`2<string, object>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |
| Keys | string[] | get |
| Values | object[] | get |

### Declared methods

- `System.Collections.Generic.Dictionary`2<string, object> .ctor()`
- `System.Collections.Generic.Dictionary`2<string, object> .ctor(int)`
- `void Add(string, object)`
- `bool TryAdd(string, object)`
- `bool ContainsKey(string)`
- `bool ContainsValue(object)`
- `bool Remove(string)`
- `void Clear()`
- `object get_Item(string)`
- `void set_Item(string, object)`

## System.Collections.Generic.Dictionary`2<int, object>

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |
| Keys | int[] | get |
| Values | object[] | get |

### Declared methods

- `System.Collections.Generic.Dictionary`2<int, object> .ctor()`
- `System.Collections.Generic.Dictionary`2<int, object> .ctor(int)`
- `void Add(int, object)`
- `bool TryAdd(int, object)`
- `bool ContainsKey(int)`
- `bool ContainsValue(object)`
- `bool Remove(int)`
- `void Clear()`
- `object get_Item(int)`
- `void set_Item(int, object)`

## System.String

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Empty | string | static get |
| Length | int | get |

### Declared methods

- `static bool IsNullOrEmpty(string)`
- `static bool IsNullOrWhiteSpace(string)`
- `static string Concat(string, string)`
- `static string Concat(string[])`
- `static string Join(string, string[])`
- `static string Join(string, int[])`
- `static bool Equals(string, string)`
- `static int CompareOrdinal(string, string)`
- `string ToString()`
- `string Substring(int)`
- `string Substring(int, int)`
- `bool Contains(string)`
- `int IndexOf(string)`
- `int IndexOf(string, int)`
- `int LastIndexOf(string)`
- `bool StartsWith(string)`
- `bool EndsWith(string)`
- `string Trim()`
- `string TrimStart()`
- `string TrimEnd()`
- `string ToUpperInvariant()`
- `string ToLowerInvariant()`
- `string ToUpper()`
- `string ToLower()`
- `string Replace(string, string)`
- `string[] Split(string)`
- `string[] Split(string, int)`
- `string PadLeft(int)`
- `string PadRight(int)`
- `string Remove(int)`
- `string Remove(int, int)`
- `string Insert(int, string)`
- `static string Format(string, object)`
- `static string Format(string, object, object)`
- `static string Format(string, object, object, object)`
- `static string Format(string, object, object, object, object)`
- `static string Format(string, object[])`

## SharpForge.Runtime.Formatting

Kind: bcl; base: object.

### Declared methods

- `static object BoxValue(object, string)`
- `static string FormatValue(object, string, int, string)`

## System.Math

Kind: bcl; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| PI | double | static get |
| E | double | static get |

### Declared methods

- `static double Sin(double)`
- `static double Cos(double)`
- `static double Tan(double)`
- `static double Asin(double)`
- `static double Acos(double)`
- `static double Atan(double)`
- `static double Log(double)`
- `static double Log10(double)`
- `static double Exp(double)`
- `static double Truncate(double)`
- `static double Atan2(double, double)`
- `static int Clamp(int, int, int)`
- `static double Clamp(double, double, double)`

## Microsoft.UI.Xaml.Media.Animation.ClockState

Kind: enum; base: System.Enum.

Enum values: Active=0, Filling=1, Stopped=2.

## Microsoft.UI.Xaml.Media.Animation.FillBehavior

Kind: enum; base: System.Enum.

Enum values: HoldEnd=0, Stop=1.

## Microsoft.UI.Xaml.Media.Animation.EasingMode

Kind: enum; base: System.Enum.

Enum values: EaseOut=0, EaseIn=1, EaseInOut=2.

## System.TimeSpan

Kind: value; base: System.ValueType.

### Properties

| Name | Type | Access |
|---|---|---|
| TotalMilliseconds | double | get |
| TotalSeconds | double | get |
| Zero | System.TimeSpan | static get |

### Declared methods

- `static System.TimeSpan FromMilliseconds(double)`
- `static System.TimeSpan FromSeconds(double)`
- `static System.TimeSpan FromMinutes(double)`

## Microsoft.UI.Xaml.Duration

Kind: value; base: System.ValueType.

### Properties

| Name | Type | Access |
|---|---|---|
| TimeSpan | System.TimeSpan | get |
| Automatic | Microsoft.UI.Xaml.Duration | static get |
| Forever | Microsoft.UI.Xaml.Duration | static get |

### Declared methods

- `Microsoft.UI.Xaml.Duration .ctor(System.TimeSpan)`

## Microsoft.UI.Xaml.Media.Animation.RepeatBehavior

Kind: value; base: System.ValueType.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | double | get |
| Duration | System.TimeSpan | get |
| Forever | Microsoft.UI.Xaml.Media.Animation.RepeatBehavior | static get |

### Declared methods

- `Microsoft.UI.Xaml.Media.Animation.RepeatBehavior .ctor(double)`
- `Microsoft.UI.Xaml.Media.Animation.RepeatBehavior .ctor(System.TimeSpan)`

## Microsoft.UI.Xaml.Media.Animation.Timeline

Kind: abstract; base: Microsoft.UI.Xaml.DependencyObject.

### Properties

| Name | Type | Access |
|---|---|---|
| Duration | Microsoft.UI.Xaml.Duration | get/set |
| BeginTime | System.TimeSpan | get/set |
| AutoReverse | bool | get/set |
| RepeatBehavior | Microsoft.UI.Xaml.Media.Animation.RepeatBehavior | get/set |
| SpeedRatio | double | get/set |
| FillBehavior | Microsoft.UI.Xaml.Media.Animation.FillBehavior | get/set |
| DurationProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BeginTimeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| AutoReverseProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RepeatBehaviorProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| SpeedRatioProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FillBehaviorProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Completed`.

### Declared methods

- `void add_Completed(Microsoft.UI.Xaml.RoutedEventHandler)`
- `void remove_Completed(Microsoft.UI.Xaml.RoutedEventHandler)`

## Microsoft.UI.Xaml.Media.Animation.TimelineCollection

Kind: collection; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | get |

### Declared methods

- `void Add(Microsoft.UI.Xaml.Media.Animation.Timeline)`
- `void Insert(int, Microsoft.UI.Xaml.Media.Animation.Timeline)`
- `Microsoft.UI.Xaml.Media.Animation.Timeline get_Item(int)`
- `bool Remove(Microsoft.UI.Xaml.Media.Animation.Timeline)`
- `void RemoveAt(int)`
- `void Clear()`

## Microsoft.UI.Xaml.Media.Animation.Storyboard

Kind: animation; base: Microsoft.UI.Xaml.Media.Animation.Timeline.

### Properties

| Name | Type | Access |
|---|---|---|
| Duration | Microsoft.UI.Xaml.Duration | get/set |
| BeginTime | System.TimeSpan | get/set |
| AutoReverse | bool | get/set |
| RepeatBehavior | Microsoft.UI.Xaml.Media.Animation.RepeatBehavior | get/set |
| SpeedRatio | double | get/set |
| FillBehavior | Microsoft.UI.Xaml.Media.Animation.FillBehavior | get/set |
| DurationProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BeginTimeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| AutoReverseProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RepeatBehaviorProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| SpeedRatioProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FillBehaviorProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Children | Microsoft.UI.Xaml.Media.Animation.TimelineCollection | get |

Events: `Completed`.

### Declared methods

- `Microsoft.UI.Xaml.Media.Animation.Storyboard .ctor()`
- `void Begin()`
- `void Pause()`
- `void Resume()`
- `void Stop()`
- `void SkipToFill()`
- `void Seek(System.TimeSpan)`
- `void SeekAlignedToLastTick(System.TimeSpan)`
- `System.TimeSpan GetCurrentTime()`
- `Microsoft.UI.Xaml.Media.Animation.ClockState GetCurrentState()`
- `static void SetTarget(Microsoft.UI.Xaml.Media.Animation.Timeline, Microsoft.UI.Xaml.DependencyObject)`
- `static Microsoft.UI.Xaml.DependencyObject GetTarget(Microsoft.UI.Xaml.Media.Animation.Timeline)`
- `static void SetTargetProperty(Microsoft.UI.Xaml.Media.Animation.Timeline, string)`
- `static string GetTargetProperty(Microsoft.UI.Xaml.Media.Animation.Timeline)`
- `static void SetTargetName(Microsoft.UI.Xaml.Media.Animation.Timeline, string)`
- `static string GetTargetName(Microsoft.UI.Xaml.Media.Animation.Timeline)`

## Microsoft.UI.Xaml.Media.Animation.EasingFunctionBase

Kind: abstract; base: Microsoft.UI.Xaml.DependencyObject.

### Properties

| Name | Type | Access |
|---|---|---|
| EasingMode | Microsoft.UI.Xaml.Media.Animation.EasingMode | get/set |
| EasingModeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

### Declared methods

- `double Ease(double)`

## Microsoft.UI.Xaml.Media.Animation.QuadraticEase

Kind: easing; base: Microsoft.UI.Xaml.Media.Animation.EasingFunctionBase.

### Properties

| Name | Type | Access |
|---|---|---|
| EasingMode | Microsoft.UI.Xaml.Media.Animation.EasingMode | get/set |
| EasingModeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

### Declared methods

- `Microsoft.UI.Xaml.Media.Animation.QuadraticEase .ctor()`

## Microsoft.UI.Xaml.Media.Animation.CubicEase

Kind: easing; base: Microsoft.UI.Xaml.Media.Animation.EasingFunctionBase.

### Properties

| Name | Type | Access |
|---|---|---|
| EasingMode | Microsoft.UI.Xaml.Media.Animation.EasingMode | get/set |
| EasingModeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

### Declared methods

- `Microsoft.UI.Xaml.Media.Animation.CubicEase .ctor()`

## Microsoft.UI.Xaml.Media.Animation.QuarticEase

Kind: easing; base: Microsoft.UI.Xaml.Media.Animation.EasingFunctionBase.

### Properties

| Name | Type | Access |
|---|---|---|
| EasingMode | Microsoft.UI.Xaml.Media.Animation.EasingMode | get/set |
| EasingModeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

### Declared methods

- `Microsoft.UI.Xaml.Media.Animation.QuarticEase .ctor()`

## Microsoft.UI.Xaml.Media.Animation.QuinticEase

Kind: easing; base: Microsoft.UI.Xaml.Media.Animation.EasingFunctionBase.

### Properties

| Name | Type | Access |
|---|---|---|
| EasingMode | Microsoft.UI.Xaml.Media.Animation.EasingMode | get/set |
| EasingModeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

### Declared methods

- `Microsoft.UI.Xaml.Media.Animation.QuinticEase .ctor()`

## Microsoft.UI.Xaml.Media.Animation.SineEase

Kind: easing; base: Microsoft.UI.Xaml.Media.Animation.EasingFunctionBase.

### Properties

| Name | Type | Access |
|---|---|---|
| EasingMode | Microsoft.UI.Xaml.Media.Animation.EasingMode | get/set |
| EasingModeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

### Declared methods

- `Microsoft.UI.Xaml.Media.Animation.SineEase .ctor()`

## Microsoft.UI.Xaml.Media.Animation.CircleEase

Kind: easing; base: Microsoft.UI.Xaml.Media.Animation.EasingFunctionBase.

### Properties

| Name | Type | Access |
|---|---|---|
| EasingMode | Microsoft.UI.Xaml.Media.Animation.EasingMode | get/set |
| EasingModeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

### Declared methods

- `Microsoft.UI.Xaml.Media.Animation.CircleEase .ctor()`

## Microsoft.UI.Xaml.Media.Animation.PowerEase

Kind: easing; base: Microsoft.UI.Xaml.Media.Animation.EasingFunctionBase.

### Properties

| Name | Type | Access |
|---|---|---|
| EasingMode | Microsoft.UI.Xaml.Media.Animation.EasingMode | get/set |
| EasingModeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Power | double | get/set |
| PowerProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

### Declared methods

- `Microsoft.UI.Xaml.Media.Animation.PowerEase .ctor()`

## Microsoft.UI.Xaml.Media.Animation.BackEase

Kind: easing; base: Microsoft.UI.Xaml.Media.Animation.EasingFunctionBase.

### Properties

| Name | Type | Access |
|---|---|---|
| EasingMode | Microsoft.UI.Xaml.Media.Animation.EasingMode | get/set |
| EasingModeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Amplitude | double | get/set |
| AmplitudeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

### Declared methods

- `Microsoft.UI.Xaml.Media.Animation.BackEase .ctor()`

## Microsoft.UI.Xaml.Media.Animation.DoubleAnimation

Kind: animation; base: Microsoft.UI.Xaml.Media.Animation.Timeline.

### Properties

| Name | Type | Access |
|---|---|---|
| Duration | Microsoft.UI.Xaml.Duration | get/set |
| BeginTime | System.TimeSpan | get/set |
| AutoReverse | bool | get/set |
| RepeatBehavior | Microsoft.UI.Xaml.Media.Animation.RepeatBehavior | get/set |
| SpeedRatio | double | get/set |
| FillBehavior | Microsoft.UI.Xaml.Media.Animation.FillBehavior | get/set |
| DurationProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| BeginTimeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| AutoReverseProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RepeatBehaviorProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| SpeedRatioProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| FillBehaviorProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| From | double | get/set |
| To | double | get/set |
| By | double | get/set |
| EasingFunction | Microsoft.UI.Xaml.Media.Animation.EasingFunctionBase | get/set |
| EnableDependentAnimation | bool | get/set |
| FromProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ToProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ByProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| EasingFunctionProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| EnableDependentAnimationProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Completed`.

### Declared methods

- `Microsoft.UI.Xaml.Media.Animation.DoubleAnimation .ctor()`

## Microsoft.UI.Xaml.Media.Transform

Kind: abstract; base: Microsoft.UI.Xaml.DependencyObject.

## Microsoft.UI.Xaml.Media.TranslateTransform

Kind: transform; base: Microsoft.UI.Xaml.Media.Transform.

### Properties

| Name | Type | Access |
|---|---|---|
| X | double | get/set |
| Y | double | get/set |
| XProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| YProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

### Declared methods

- `Microsoft.UI.Xaml.Media.TranslateTransform .ctor()`

## Microsoft.UI.Xaml.Media.ScaleTransform

Kind: transform; base: Microsoft.UI.Xaml.Media.Transform.

### Properties

| Name | Type | Access |
|---|---|---|
| ScaleX | double | get/set |
| ScaleY | double | get/set |
| CenterX | double | get/set |
| CenterY | double | get/set |
| ScaleXProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ScaleYProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CenterXProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CenterYProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

### Declared methods

- `Microsoft.UI.Xaml.Media.ScaleTransform .ctor()`

## Microsoft.UI.Xaml.Media.RotateTransform

Kind: transform; base: Microsoft.UI.Xaml.Media.Transform.

### Properties

| Name | Type | Access |
|---|---|---|
| Angle | double | get/set |
| CenterX | double | get/set |
| CenterY | double | get/set |
| AngleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CenterXProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CenterYProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

### Declared methods

- `Microsoft.UI.Xaml.Media.RotateTransform .ctor()`

## Microsoft.UI.Xaml.Media.SkewTransform

Kind: transform; base: Microsoft.UI.Xaml.Media.Transform.

### Properties

| Name | Type | Access |
|---|---|---|
| AngleX | double | get/set |
| AngleY | double | get/set |
| CenterX | double | get/set |
| CenterY | double | get/set |
| AngleXProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| AngleYProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CenterXProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CenterYProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

### Declared methods

- `Microsoft.UI.Xaml.Media.SkewTransform .ctor()`

## Microsoft.UI.Xaml.Media.CompositeTransform

Kind: transform; base: Microsoft.UI.Xaml.Media.Transform.

### Properties

| Name | Type | Access |
|---|---|---|
| TranslateX | double | get/set |
| TranslateY | double | get/set |
| ScaleX | double | get/set |
| ScaleY | double | get/set |
| Rotation | double | get/set |
| SkewX | double | get/set |
| SkewY | double | get/set |
| CenterX | double | get/set |
| CenterY | double | get/set |
| TranslateXProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TranslateYProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ScaleXProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ScaleYProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RotationProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| SkewXProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| SkewYProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CenterXProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| CenterYProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

### Declared methods

- `Microsoft.UI.Xaml.Media.CompositeTransform .ctor()`

## Microsoft.UI.Xaml.Controls.WrapGrid

Kind: control; base: Microsoft.UI.Xaml.Controls.Panel.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Children | Microsoft.UI.Xaml.Controls.UIElementCollection | get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ItemWidth | double | get/set |
| ItemHeight | double | get/set |
| MaximumRowsOrColumns | int | get/set |
| Orientation | Microsoft.UI.Xaml.Controls.Orientation | get/set |
| ItemWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ItemHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaximumRowsOrColumnsProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OrientationProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.WrapGrid .ctor()`

## Microsoft.UI.Xaml.Controls.VariableSizedWrapGrid

Kind: control; base: Microsoft.UI.Xaml.Controls.Panel.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Children | Microsoft.UI.Xaml.Controls.UIElementCollection | get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ItemWidth | double | get/set |
| ItemHeight | double | get/set |
| MaximumRowsOrColumns | int | get/set |
| Orientation | Microsoft.UI.Xaml.Controls.Orientation | get/set |
| ItemWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ItemHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaximumRowsOrColumnsProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OrientationProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.VariableSizedWrapGrid .ctor()`
- `static void SetRowSpan(Microsoft.UI.Xaml.UIElement, int)`
- `static int GetRowSpan(Microsoft.UI.Xaml.UIElement)`
- `static void SetColumnSpan(Microsoft.UI.Xaml.UIElement, int)`
- `static int GetColumnSpan(Microsoft.UI.Xaml.UIElement)`

## Microsoft.UI.Xaml.Controls.ItemsWrapGrid

Kind: control; base: Microsoft.UI.Xaml.Controls.Panel.

### Properties

| Name | Type | Access |
|---|---|---|
| Visibility | Microsoft.UI.Xaml.Visibility | get/set |
| Opacity | double | get/set |
| IsHitTestVisible | bool | get/set |
| ContextFlyout | Microsoft.UI.Xaml.Controls.MenuFlyout | get/set |
| VisibilityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OpacityProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| IsHitTestVisibleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ContextFlyoutProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RenderTransform | Microsoft.UI.Xaml.Media.Transform | get/set |
| RenderTransformProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Name | string | get/set |
| Width | double | get/set |
| Height | double | get/set |
| MinWidth | double | get/set |
| MinHeight | double | get/set |
| MaxWidth | double | get/set |
| MaxHeight | double | get/set |
| Margin | Microsoft.UI.Xaml.Thickness | get/set |
| HorizontalAlignment | Microsoft.UI.Xaml.HorizontalAlignment | get/set |
| VerticalAlignment | Microsoft.UI.Xaml.VerticalAlignment | get/set |
| RequestedTheme | Microsoft.UI.Xaml.ElementTheme | get/set |
| Tag | object | get/set |
| ActualWidth | double | get |
| ActualHeight | double | get |
| Style | Microsoft.UI.Xaml.Style | get/set |
| NameProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| WidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MinHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaxHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MarginProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| HorizontalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| VerticalAlignmentProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| RequestedThemeProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| TagProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| StyleProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| Background | Microsoft.UI.Xaml.Media.Brush | get/set |
| Children | Microsoft.UI.Xaml.Controls.UIElementCollection | get |
| BackgroundProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ItemWidth | double | get/set |
| ItemHeight | double | get/set |
| MaximumRowsOrColumns | int | get/set |
| Orientation | Microsoft.UI.Xaml.Controls.Orientation | get/set |
| ItemWidthProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| ItemHeightProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| MaximumRowsOrColumnsProperty | Microsoft.UI.Xaml.DependencyProperty | static get |
| OrientationProperty | Microsoft.UI.Xaml.DependencyProperty | static get |

Events: `Loaded`, `Unloaded`.

### Declared methods

- `Microsoft.UI.Xaml.Controls.ItemsWrapGrid .ctor()`

## SharpForge.UI.AnimationClock

Kind: static; base: object.

### Declared methods

- `static void AdvanceBy(double)`

## System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage>

Kind: task; base: System.Threading.Tasks.Task.

### Properties

| Name | Type | Access |
|---|---|---|
| Id | int | get |
| IsCompleted | bool | get |
| IsFaulted | bool | get |
| IsCanceled | bool | get |
| CompletedTask | System.Threading.Tasks.Task | static get |
| Result | System.Net.Http.HttpResponseMessage | get |

### Declared methods

- `void Wait()`

## System.Func`1<System.Net.Http.HttpResponseMessage>

Kind: delegate; base: System.MulticastDelegate.

### Declared methods

- `System.Func`1<System.Net.Http.HttpResponseMessage> .ctor(object, nint)`
- `System.Net.Http.HttpResponseMessage Invoke()`

## System.Threading.Tasks.Task`1<double[]>

Kind: task; base: System.Threading.Tasks.Task.

### Properties

| Name | Type | Access |
|---|---|---|
| Id | int | get |
| IsCompleted | bool | get |
| IsFaulted | bool | get |
| IsCanceled | bool | get |
| CompletedTask | System.Threading.Tasks.Task | static get |
| Result | double[] | get |

### Declared methods

- `void Wait()`

## System.Func`1<double[]>

Kind: delegate; base: System.MulticastDelegate.

### Declared methods

- `System.Func`1<double[]> .ctor(object, nint)`
- `double[] Invoke()`

## System.Uri

Kind: network; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| OriginalString | string | get |
| AbsoluteUri | string | get |
| AbsolutePath | string | get |
| Host | string | get |
| Scheme | string | get |
| Port | int | get |
| IsAbsoluteUri | bool | get |

### Declared methods

- `System.Uri .ctor(string)`
- `System.Uri .ctor(System.Uri, string)`
- `string ToString()`
- `static string EscapeDataString(string)`
- `static string UnescapeDataString(string)`

## System.Net.Http.HttpClient

Kind: network; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| BaseAddress | System.Uri | get/set |
| Timeout | System.TimeSpan | get/set |
| DefaultRequestHeaders | System.Net.Http.Headers.HttpRequestHeaders | get |

### Declared methods

- `System.Net.Http.HttpClient .ctor()`
- `System.Threading.Tasks.Task`1<string> GetStringAsync(string)`
- `System.Threading.Tasks.Task`1<string> GetStringAsync(string, System.Threading.CancellationToken)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> GetAsync(string)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> GetAsync(string, System.Threading.CancellationToken)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> DeleteAsync(string)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> DeleteAsync(string, System.Threading.CancellationToken)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> PostAsync(string, System.Net.Http.HttpContent)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> PostAsync(string, System.Net.Http.HttpContent, System.Threading.CancellationToken)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> PutAsync(string, System.Net.Http.HttpContent)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> PutAsync(string, System.Net.Http.HttpContent, System.Threading.CancellationToken)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> PatchAsync(string, System.Net.Http.HttpContent)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> PatchAsync(string, System.Net.Http.HttpContent, System.Threading.CancellationToken)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> SendAsync(System.Net.Http.HttpRequestMessage)`
- `System.Threading.Tasks.Task`1<System.Net.Http.HttpResponseMessage> SendAsync(System.Net.Http.HttpRequestMessage, System.Threading.CancellationToken)`
- `void Dispose()`
- `void CancelPendingRequests()`

## System.Net.Http.HttpRequestMessage

Kind: network; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Method | System.Net.Http.HttpMethod | get/set |
| RequestUri | System.Uri | get/set |
| Content | System.Net.Http.HttpContent | get/set |
| Headers | System.Net.Http.Headers.HttpRequestHeaders | get |

### Declared methods

- `System.Net.Http.HttpRequestMessage .ctor()`
- `System.Net.Http.HttpRequestMessage .ctor(System.Net.Http.HttpMethod, string)`
- `void Dispose()`

## System.Net.Http.HttpResponseMessage

Kind: network; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| StatusCode | System.Net.HttpStatusCode | get |
| ReasonPhrase | string | get |
| IsSuccessStatusCode | bool | get |
| Content | System.Net.Http.HttpContent | get |
| Headers | System.Net.Http.Headers.HttpResponseHeaders | get |

### Declared methods

- `System.Net.Http.HttpResponseMessage EnsureSuccessStatusCode()`
- `void Dispose()`

## System.Net.Http.HttpMethod

Kind: network; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Get | System.Net.Http.HttpMethod | static get |
| Post | System.Net.Http.HttpMethod | static get |
| Put | System.Net.Http.HttpMethod | static get |
| Delete | System.Net.Http.HttpMethod | static get |
| Patch | System.Net.Http.HttpMethod | static get |
| Head | System.Net.Http.HttpMethod | static get |
| Options | System.Net.Http.HttpMethod | static get |
| Method | string | get |

### Declared methods

- `System.Net.Http.HttpMethod .ctor(string)`
- `string ToString()`

## System.Net.Http.HttpContent

Kind: network; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Headers | System.Net.Http.Headers.HttpContentHeaders | get |

### Declared methods

- `System.Threading.Tasks.Task`1<string> ReadAsStringAsync()`
- `void Dispose()`

## System.Net.Http.StringContent

Kind: network; base: System.Net.Http.HttpContent.

### Properties

| Name | Type | Access |
|---|---|---|
| Headers | System.Net.Http.Headers.HttpContentHeaders | get |

### Declared methods

- `System.Net.Http.StringContent .ctor(string)`

## System.Net.Http.Headers.HttpRequestHeaders

Kind: network; base: object.

### Declared methods

- `void Add(string, string)`
- `bool TryAddWithoutValidation(string, string)`
- `bool Remove(string)`
- `bool Contains(string)`
- `void Clear()`
- `string ToString()`

## System.Net.Http.Headers.HttpResponseHeaders

Kind: network; base: object.

### Declared methods

- `void Add(string, string)`
- `bool TryAddWithoutValidation(string, string)`
- `bool Remove(string)`
- `bool Contains(string)`
- `void Clear()`
- `string ToString()`

## System.Net.Http.Headers.HttpContentHeaders

Kind: network; base: object.

### Declared methods

- `void Add(string, string)`
- `bool TryAddWithoutValidation(string, string)`
- `bool Remove(string)`
- `bool Contains(string)`
- `void Clear()`
- `string ToString()`

## System.Net.HttpStatusCode

Kind: enum; base: System.Enum.

Enum values: OK=200, Created=201, Accepted=202, NoContent=204, MovedPermanently=301, Redirect=302, NotModified=304, BadRequest=400, Unauthorized=401, Forbidden=403, NotFound=404, RequestTimeout=408, Conflict=409, TooManyRequests=429, InternalServerError=500, BadGateway=502, ServiceUnavailable=503, GatewayTimeout=504.

## System.Threading.CancellationToken

Kind: network; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| IsCancellationRequested | bool | get |
| CanBeCanceled | bool | get |
| None | System.Threading.CancellationToken | static get |

### Declared methods

- `void ThrowIfCancellationRequested()`

## System.Threading.CancellationTokenSource

Kind: network; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Token | System.Threading.CancellationToken | get |
| IsCancellationRequested | bool | get |

### Declared methods

- `System.Threading.CancellationTokenSource .ctor()`
- `void Cancel()`
- `void Dispose()`

## System.Numerics.Vector

Kind: numeric; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| IsHardwareAccelerated | bool | static get |

### Declared methods

- `static System.Numerics.Vector`1<int> Add(System.Numerics.Vector`1<int>, System.Numerics.Vector`1<int>)`
- `static System.Numerics.Vector`1<int> Subtract(System.Numerics.Vector`1<int>, System.Numerics.Vector`1<int>)`
- `static System.Numerics.Vector`1<int> Multiply(System.Numerics.Vector`1<int>, System.Numerics.Vector`1<int>)`
- `static System.Numerics.Vector`1<int> Min(System.Numerics.Vector`1<int>, System.Numerics.Vector`1<int>)`
- `static System.Numerics.Vector`1<int> Max(System.Numerics.Vector`1<int>, System.Numerics.Vector`1<int>)`
- `static System.Numerics.Vector`1<int> BitwiseAnd(System.Numerics.Vector`1<int>, System.Numerics.Vector`1<int>)`
- `static System.Numerics.Vector`1<int> Xor(System.Numerics.Vector`1<int>, System.Numerics.Vector`1<int>)`
- `static int Dot(System.Numerics.Vector`1<int>, System.Numerics.Vector`1<int>)`
- `static int Sum(System.Numerics.Vector`1<int>)`
- `static bool EqualsAll(System.Numerics.Vector`1<int>, System.Numerics.Vector`1<int>)`
- `static bool EqualsAny(System.Numerics.Vector`1<int>, System.Numerics.Vector`1<int>)`
- `static System.Numerics.Vector`1<double> Add(System.Numerics.Vector`1<double>, System.Numerics.Vector`1<double>)`
- `static System.Numerics.Vector`1<double> Subtract(System.Numerics.Vector`1<double>, System.Numerics.Vector`1<double>)`
- `static System.Numerics.Vector`1<double> Multiply(System.Numerics.Vector`1<double>, System.Numerics.Vector`1<double>)`
- `static System.Numerics.Vector`1<double> Min(System.Numerics.Vector`1<double>, System.Numerics.Vector`1<double>)`
- `static System.Numerics.Vector`1<double> Max(System.Numerics.Vector`1<double>, System.Numerics.Vector`1<double>)`
- `static System.Numerics.Vector`1<double> Divide(System.Numerics.Vector`1<double>, System.Numerics.Vector`1<double>)`
- `static double Dot(System.Numerics.Vector`1<double>, System.Numerics.Vector`1<double>)`
- `static double Sum(System.Numerics.Vector`1<double>)`
- `static bool EqualsAll(System.Numerics.Vector`1<double>, System.Numerics.Vector`1<double>)`
- `static bool EqualsAny(System.Numerics.Vector`1<double>, System.Numerics.Vector`1<double>)`

## System.Numerics.Vector`1<int>

Kind: numeric; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | static get |
| Zero | System.Numerics.Vector`1<int> | static get |
| One | System.Numerics.Vector`1<int> | static get |

### Declared methods

- `System.Numerics.Vector`1<int> .ctor(int)`
- `System.Numerics.Vector`1<int> .ctor(int[])`
- `System.Numerics.Vector`1<int> .ctor(int[], int)`
- `int get_Item(int)`
- `void CopyTo(int[])`
- `void CopyTo(int[], int)`
- `bool Equals(System.Numerics.Vector`1<int>)`

## System.Numerics.Vector`1<double>

Kind: numeric; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Count | int | static get |
| Zero | System.Numerics.Vector`1<double> | static get |
| One | System.Numerics.Vector`1<double> | static get |

### Declared methods

- `System.Numerics.Vector`1<double> .ctor(double)`
- `System.Numerics.Vector`1<double> .ctor(double[])`
- `System.Numerics.Vector`1<double> .ctor(double[], int)`
- `double get_Item(int)`
- `void CopyTo(double[])`
- `void CopyTo(double[], int)`
- `bool Equals(System.Numerics.Vector`1<double>)`

## SharpForge.Runtime.ParallelMath

Kind: numeric; base: object.

### Declared methods

- `static System.Threading.Tasks.Task`1<double> SumAsync(double[])`
- `static System.Threading.Tasks.Task`1<double> DotAsync(double[], double[])`
- `static System.Threading.Tasks.Task`1<double[]> AddAsync(double[], double[])`
- `static System.Threading.Tasks.Task`1<double[]> MultiplyAsync(double[], double[])`

## System.Array

Kind: bcl14; base: object.

### Declared methods

- `static void Copy(int[], int[], int)`
- `static void Copy(int[], int, int[], int, int)`
- `static void Clear(int[], int, int)`
- `static void Fill(int[], int)`
- `static void Fill(int[], int, int, int)`
- `static int IndexOf(int[], int)`
- `static int LastIndexOf(int[], int)`
- `static int BinarySearch(int[], int)`
- `static void Copy(double[], double[], int)`
- `static void Copy(double[], int, double[], int, int)`
- `static void Clear(double[], int, int)`
- `static void Fill(double[], double)`
- `static void Fill(double[], double, int, int)`
- `static int IndexOf(double[], double)`
- `static int LastIndexOf(double[], double)`
- `static int BinarySearch(double[], double)`
- `static void Copy(bool[], bool[], int)`
- `static void Copy(bool[], int, bool[], int, int)`
- `static void Clear(bool[], int, int)`
- `static void Fill(bool[], bool)`
- `static void Fill(bool[], bool, int, int)`
- `static int IndexOf(bool[], bool)`
- `static int LastIndexOf(bool[], bool)`
- `static int BinarySearch(bool[], bool)`
- `static void Copy(string[], string[], int)`
- `static void Copy(string[], int, string[], int, int)`
- `static void Clear(string[], int, int)`
- `static void Fill(string[], string)`
- `static void Fill(string[], string, int, int)`
- `static int IndexOf(string[], string)`
- `static int LastIndexOf(string[], string)`
- `static int BinarySearch(string[], string)`
- `static void Copy(object[], object[], int)`
- `static void Copy(object[], int, object[], int, int)`
- `static void Clear(object[], int, int)`
- `static void Fill(object[], object)`
- `static void Fill(object[], object, int, int)`
- `static int IndexOf(object[], object)`
- `static int LastIndexOf(object[], object)`
- `static int BinarySearch(object[], object)`

## System.Random

Kind: bcl14; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Shared | System.Random | static get |

### Declared methods

- `System.Random .ctor()`
- `System.Random .ctor(int)`
- `int Next()`
- `int Next(int)`
- `int Next(int, int)`
- `double NextDouble()`

## System.Text.Json.JsonDocument

Kind: bcl14; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| RootElement | System.Text.Json.JsonElement | get |

### Declared methods

- `static System.Text.Json.JsonDocument Parse(string)`
- `void Dispose()`

## System.Text.Json.JsonElement

Kind: bcl14; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| ValueKind | System.Text.Json.JsonValueKind | get |

### Declared methods

- `System.Text.Json.JsonElement GetProperty(string)`
- `System.Text.Json.JsonElement get_Item(int)`
- `int GetArrayLength()`
- `string GetString()`
- `int GetInt32()`
- `double GetDouble()`
- `bool GetBoolean()`
- `string GetRawText()`
- `string ToString()`
- `System.Text.Json.JsonElement.ArrayEnumerator EnumerateArray()`
- `System.Text.Json.JsonElement.ObjectEnumerator EnumerateObject()`

## System.Text.Json.JsonValueKind

Kind: enum; base: System.Enum.

Enum values: Undefined=0, Object=1, Array=2, String=3, Number=4, True=5, False=6, Null=7.

## System.Text.Json.JsonProperty

Kind: bcl14; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Name | string | get |
| Value | System.Text.Json.JsonElement | get |

## System.Text.Json.JsonElement.ArrayEnumerator

Kind: bcl14; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Current | System.Text.Json.JsonElement | get |

### Declared methods

- `System.Text.Json.JsonElement.ArrayEnumerator GetEnumerator()`
- `bool MoveNext()`
- `void Dispose()`

## System.Text.Json.JsonElement.ObjectEnumerator

Kind: bcl14; base: object.

### Properties

| Name | Type | Access |
|---|---|---|
| Current | System.Text.Json.JsonProperty | get |

### Declared methods

- `System.Text.Json.JsonElement.ObjectEnumerator GetEnumerator()`
- `bool MoveNext()`
- `void Dispose()`

## System.Text.Json.JsonSerializer

Kind: bcl14; base: object.

### Declared methods

- `static string Serialize(object)`

