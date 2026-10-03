# DebuggerWorkshop

Open this folder in Studio, select DebuggerWorkshop.slnx, then set a breakpoint on Program.cs line 6 and press F5. At that stop, value is 0. Right-click value in Locals and select Break on write; continue. The write stop is **Program.cs:6 after assignment**, value 42—not Answers.cs:5. Step into the call to see separate executing and caller markers; use Show Next Statement to return to the executing frame.

The browser preview compiles this supported subset without a native SDK. Native .NET compilation is a separate, unqualified-in-this-container workflow.
