# Source synchronization, common BCL and WinUI playback examples

Each directory has Program.cs, a csproj, a slnx and a sibling standard workspace ZIP. Open the ZIP/folder in SharpForge or run its solution through the CLI. Native Windows App SDK/CLR portability is not asserted.

| Directory | Workflow |
|---|---|
| DesignerCsharpSync | Designer → Connect C# → Program.cs; edits preserve OnAction. |
| WinuiStoryboards | Managed Play/Pause/Resume/Stop and Completed. |
| WinuiWrapPanels | Wrapping cards with a two-cell span. |
| AnimationStylePrecedence | Headless timeline sampling; latest style restored on Stop. |
| BclCollections | List, HashSet, Queue, Stack, enumeration and formatting. |
| BclDictionary | String-keyed inventory with snapshot key iteration. |
| BclStringbuilder | String helpers and managed StringBuilder. |
| CsharpInterpolation | Escapes, alignment, primitive formats and verbatim text. |

```sh
node apps/cli/main.js run examples/release13/BclDictionary/BclDictionary.slnx
# pencils: 12
# books: 5
# Total: 17
```
