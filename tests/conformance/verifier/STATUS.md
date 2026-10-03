# ECMA-335 verifier initial coverage

Generated from `fixtures.json` and `upstream.json`. No native oracle capture has been run.

| Rule | Section | Accept/reject pair | Oracle |
| --- | --- | --- | --- |
| stack-underflow | III.1.8.1 | present | not run |
| stack-overflow | III.1.8.1 | present | not run |
| void-return | III.3.57 | present | not run |
| missing-return | III.3.57 | present | not run |
| extra-return | III.3.57 | present | not run |
| return-type | III.3.57 | present | not run |
| local-index | III.3.43 | present | not run |
| argument-index | III.3.38 | present | not run |
| shift-count | III.3.58 | present | not run |
| numeric-negation | III.3.50 | present | not run |
| throw-reference | III.4.31 | present | not run |
| rethrow-handler | III.4.24 | present | not run |
| endfinally-handler | III.3.35 | present | not run |
| branch-stack-depth | III.1.8.1.3 | present | not run |
| volatile-prefix | III.2.6 | present | not run |
| unaligned-prefix | III.2.5 | present | not run |

## ILVerify diagnostic inventory

| Diagnostic | Imported rejecting methods | Authored pair |
| --- | ---: | --- |
| UnknownOpcode | 0 | missing |
| MethodFallthrough | 2 | missing |
| FallthroughException | 4 | missing |
| FallthroughIntoHandler | 2 | missing |
| FallthroughIntoFilter | 1 | missing |
| LeaveIntoTry | 4 | missing |
| LeaveIntoHandler | 3 | missing |
| LeaveIntoFilter | 2 | missing |
| LeaveOutOfFilter | 2 | missing |
| LeaveOutOfFinally | 2 | missing |
| LeaveOutOfFault | 2 | missing |
| Rethrow | 0 | present |
| Endfinally | 0 | present |
| Endfilter | 0 | missing |
| BranchIntoTry | 6 | missing |
| BranchIntoHandler | 2 | missing |
| BranchIntoFilter | 1 | missing |
| BranchOutOfTry | 9 | missing |
| BranchOutOfHandler | 0 | missing |
| BranchOutOfFilter | 0 | missing |
| BranchOutOfFinally | 1 | missing |
| ReturnFromTry | 1 | missing |
| ReturnFromHandler | 1 | missing |
| ReturnFromFilter | 1 | missing |
| BadJumpTarget | 5 | missing |
| PathStackUnexpected | 0 | missing |
| PathStackDepth | 0 | present |
| ThisUninitStore | 0 | missing |
| ThisUninitReturn | 0 | missing |
| LdftnCtor | 0 | missing |
| StackUnexpected | 36 | present |
| StackUnexpectedArrayType | 0 | missing |
| StackOverflow | 0 | present |
| StackUnderflow | 1 | present |
| UninitStack | 0 | missing |
| ExpectedIntegerType | 3 | present |
| ExpectedFloatType | 0 | missing |
| ExpectedNumericType | 1 | present |
| StackObjRef | 2 | present |
| StackByRef | 0 | missing |
| StackMethod | 0 | missing |
| UnrecognizedLocalNumber | 0 | present |
| UnrecognizedArgumentNumber | 0 | present |
| ExpectedTypeToken | 0 | missing |
| TokenResolve | 0 | missing |
| ExpectedMethodToken | 0 | missing |
| ExpectedFieldToken | 0 | missing |
| Unverifiable | 3 | missing |
| StringOperand | 0 | missing |
| ReturnPtrToStack | 2 | missing |
| ReturnVoid | 1 | present |
| ReturnMissing | 1 | present |
| ReturnEmpty | 1 | present |
| ExpectedArray | 0 | missing |
| ValueTypeExpected | 0 | missing |
| TypeAccess | 2 | missing |
| MethodAccess | 23 | missing |
| FieldAccess | 4 | missing |
| ExpectedStaticField | 0 | missing |
| InitOnly | 1 | missing |
| CallVirtOnValueType | 0 | missing |
| CtorExpected | 2 | missing |
| CtorSig | 1 | missing |
| ArrayByRef | 0 | missing |
| ByrefOfByref | 0 | missing |
| CodeSizeZero | 0 | missing |
| TailCall | 1 | missing |
| TailByRef | 0 | missing |
| TailRet | 4 | missing |
| TailRetVoid | 0 | missing |
| TailRetType | 0 | missing |
| TailStackEmpty | 0 | missing |
| MethodEnd | 0 | missing |
| BadBranch | 0 | missing |
| Volatile | 0 | present |
| Unaligned | 0 | present |
| CallAbstract | 0 | missing |
| TryNonEmptyStack | 0 | missing |
| FilterOrCatchUnexpectedStack | 0 | missing |
| FinOrFaultNonEmptyStack | 0 | missing |
| DelegateCtor | 12 | missing |
| DelegatePattern | 5 | missing |
| BoxByRef | 1 | missing |
| EndfilterStack | 0 | missing |
| DelegateCtorSigI | 0 | missing |
| DelegateCtorSigO | 2 | missing |
| CatchByRef | 0 | missing |
| ThrowOrCatchOnlyExceptionType | 2 | missing |
| LdvirtftnOnStatic | 1 | missing |
| CallVirtOnStatic | 0 | missing |
| InitLocals | 0 | missing |
| CallCtor | 0 | missing |
| ExpectedValClassObjRefVariable | 1 | missing |
| ReadOnly | 1 | missing |
| Constrained | 0 | missing |
| UnsatisfiedMethodInst | 1 | missing |
| UnsatisfiedMethodParentInst | 2 | missing |
| UnsatisfiedFieldParentInst | 1 | missing |
| UnsatisfiedBoxOperand | 1 | missing |
| ConstrainedCallWithNonByRefThis | 0 | missing |
| ReadonlyUnexpectedCallee | 1 | missing |
| ReadOnlyIllegalWrite | 0 | missing |
| TailCallInsideER | 1 | missing |
| BackwardBranch | 1 | missing |
| NewobjAbstractClass | 0 | missing |
| UnmanagedPointer | 0 | missing |
| LdftnNonFinalVirtual | 1 | missing |
| ThisMismatch | 3 | missing |
| InterfaceImplHasDuplicate | 0 | missing |
| InterfaceMethodNotImplemented | 0 | missing |
| LocallocStackNotEmpty | 1 | missing |
