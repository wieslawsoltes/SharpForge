# Debugger examples — 0.9

The five examples also appear in Studio. F5 uses their requested source/function breakpoints and watches. Ctrl+F5 runs to completion without breakpoints. Each emitted assembly is executed by four test routes: internal VM, canonical CIL reload, direct CIL and IL export/reassembly.

## Exact breakpoint locations

F5 stops at the multiline WriteLine statement, not the following statement. Requested continuation line and executing span stay distinct.

Expected program output:
```text
0
1
2
```

## Caller storage and stack frames

At the assignment, right-click value in Locals and choose Break on write. Continue stops after assignment at the caller, not at the return in Answers.cs.

Expected program output:
```text
42
```

## Changed conditions and reverse replay

F5 stops when i/2 changes: i=2 and i=4. Reverse Continue restores the previous retained stop and its encounter count.

Expected program output:
```text
0
1
2
3
4
5
```

## Conditional function breakpoints

F5 stops in MathBox.AddOne(int) only when value >= 2. Select Main to inspect the caller; Show Next Statement returns to the actual executing frame.

Expected program output:
```text
1
2
3
```

## Exception stops and cleanup replay

Add System.OverflowException → When thrown in Debugger / Exception Settings. The stop is at checked arithmetic before unwinding; reverse replay preserves the pending fault.

Expected program output:
```text
overflow caught
cleanup
42
```
