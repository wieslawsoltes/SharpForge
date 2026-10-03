# CheckedResources

Open this folder, select CheckedResources.slnx and App/App.csproj, and run. Output:

```
checked project
-2147483648
disposed
```

The app enables CheckForOverflowUnderflow; its referenced library disables it. SharpForge combines their source files but preserves each source file’s overflow setting. The using declaration disposes its concrete IDisposable resource at the end of the top-level scope. Directory.Build.props supplies the target framework. This is not separate-assembly linking or full MSBuild.
