class C { static T First<T>(System.ReadOnlySpan<T> s) => s[0]; static int M() => First(new int[]{1}); }
