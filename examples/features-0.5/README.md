# Feature examples — 0.5.0

The seven C# files also appear independently in Studio’s Examples panel. Run any file through the CLI; they do not share a compilation.

## Properties & computed accessors

`properties.cs`: Auto-properties, private setters, initializer values, and computed getters.

Expected output:

```text
7
18
9
```

## Constructor-owned properties

`readonly-properties.cs`: Getter-only auto-properties initialized in the owning constructor.

Expected output:

```text
Ada
42
```

## Finally & nested unwinding

`finally.cs`: Cleanup runs for return, throw, and caught exceptions; step through with F11.

Expected output:

```text
cleanup
42
inner cleanup
failure
outer cleanup
```

## Cleanup on loop exits

`finally-loop.cs`: Continue and break unwind protected regions without losing loop state.

Expected output:

```text
cleanup 0
1
cleanup 1
cleanup 2
done
```

## Structural refactorings

`structural-refactoring.cs`: Ctrl+. on a property/local/if; select a whole initializer to introduce a local.

Expected output:

```text
18
positive
```

## Safe property watches & GC

`safe-watches.cs`: Pause before the final output; inspect row.Value and retaining paths without getter execution.

Expected output:

```text
42
```

## Analyzer diagnostics

`analyzer-tasks.cs`: Enable analyzers for task-comment hints and literal-condition information.

Expected output:

```text
ready
```

