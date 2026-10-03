# ECMA-335 verifier rule coverage

ILVerify diagnostic IDs are not ECMA rule IDs. Section mappings identify the versioned method-body constraints.

| Rule | ECMA-335 section | Accept | Reject | Oracle |
| --- | --- | --- | --- | --- |
| stack-underflow | III.1.8.1 | stack-underflow-accept | stack-underflow-reject | not run |
| stack-overflow | III.1.8.1 | stack-overflow-accept | stack-overflow-reject | not run |
| void-return | III.3.57 | void-return-accept | void-return-reject | not run |
| missing-return | III.3.57 | missing-return-accept | missing-return-reject | not run |
| extra-return | III.3.57 | extra-return-accept | extra-return-reject | not run |
| return-type | III.3.57 | return-type-accept | return-type-reject | not run |
| local-index | III.3.43 | local-index-accept | local-index-reject | not run |
| argument-index | III.3.38 | argument-index-accept | argument-index-reject | not run |
| shift-count | III.3.58 | shift-count-accept | shift-count-reject | not run |
| numeric-negation | III.3.50 | numeric-negation-accept | numeric-negation-reject | not run |
| throw-reference | III.4.31 | throw-reference-accept | throw-reference-reject | not run |
| rethrow-handler | III.4.24 | rethrow-handler-accept | rethrow-handler-reject | not run |
| endfinally-handler | III.3.35 | endfinally-handler-accept | endfinally-handler-reject | not run |
| branch-stack-depth | III.1.8.1.3 | branch-stack-depth-accept | branch-stack-depth-reject | not run |
| volatile-prefix | III.2.6 | volatile-prefix-accept | volatile-prefix-reject | not run |
| unaligned-prefix | III.2.5 | unaligned-prefix-accept | unaligned-prefix-reject | not run |
| method-fallthrough | III.1.7.3 | method-fallthrough-accept | method-fallthrough-reject | not run |
| fallthrough-handler | III.1.8.1 | fallthrough-handler-accept | fallthrough-handler-reject | not run |
| fallthrough-filter | III.1.8.1 | fallthrough-filter-accept | fallthrough-filter-reject | not run |
| leave-into-try | III.3.46 | leave-into-try-accept | leave-into-try-reject | not run |
| leave-into-handler | III.3.46 | leave-into-handler-accept | leave-into-handler-reject | not run |
| leave-into-filter | III.3.46 | fallthrough-filter-accept | leave-into-filter-reject | not run |
| leave-out-of-filter | III.3.46 | fallthrough-filter-accept | leave-out-of-filter-reject | not run |
| leave-out-of-finally | III.3.46 | leave-out-of-finally-accept | leave-out-of-finally-reject | not run |
| leave-out-of-fault | III.3.46 | leave-out-of-fault-accept | leave-out-of-fault-reject | not run |
| branch-into-try | III.1.8.1 | branch-into-try-accept | branch-into-try-reject | not run |
| branch-out-of-try | III.1.8.1 | fallthrough-handler-accept | branch-out-of-try-reject | not run |
| branch-into-handler | III.1.8.1 | fallthrough-handler-accept | branch-into-handler-reject | not run |
| branch-into-filter | III.1.8.1 | fallthrough-handler-accept | branch-into-filter-reject | not run |
| branch-out-of-finally | III.1.8.1 | leave-out-of-finally-accept | branch-out-of-finally-reject | not run |
| prefix-branch-target | III.1.7.2 | prefix-branch-target-accept | prefix-branch-target-reject | not run |
| return-byref-lifetime | III.3.57 | return-byref-lifetime-accept | return-byref-lifetime-reject | not run |
| delegate-signature | III.1.8.1.5 | delegate-signature-accept | delegate-signature-reject | not run |
| delegate-sequence | III.1.8.1.5 | delegate-sequence-accept | delegate-sequence-reject | not run |
| ldvirtftn-static | III.4.18 | delegate-sequence-accept | ldvirtftn-static-reject | not run |
| readonly-prefix | III.2.3 | readonly-prefix-accept | readonly-prefix-reject | not run |
| readonly-callee | III.2.3 | readonly-callee-accept | readonly-callee-reject | not run |
| tail-next-instruction | III.2.4 | tail-next-instruction-accept | tail-next-instruction-reject | not run |
| tail-return | III.2.4 | tail-next-instruction-accept | tail-return-reject | not run |
| tail-protected-region | III.2.4 | tail-next-instruction-accept | tail-protected-region-reject | not run |
| backward-branch | III.1.7.5 | backward-branch-accept | backward-branch-reject | not run |
| base-call-this | III.3.19 | base-call-this-accept | base-call-this-reject | not run |
| generic-owner-constraint | III.3.41 | generic-owner-constraint-accept | generic-owner-constraint-reject | not run |
| endfilter-region | III.3.34 | endfilter-region-accept | endfilter-region-reject | not run |
| branch-out-of-catch | III.1.8.1 | branch-out-of-catch-accept | branch-out-of-catch-reject | not run |
| branch-out-of-filter | III.1.8.1 | branch-out-of-filter-accept | branch-out-of-filter-reject | not run |
| return-in-try | III.3.57 | return-in-try-accept | return-in-try-reject | not run |
| return-in-handler | III.3.57 | return-in-handler-accept | return-in-handler-reject | not run |
| return-in-filter | III.3.57 | return-in-filter-accept | return-in-filter-reject | not run |
| stack-merge-types | III.1.8.1.3 | stack-merge-types-accept | stack-merge-types-reject | not run |
| constructor-initialization | III.1.8.1.4 | constructor-initialization-accept | constructor-initialization-reject | not run |
| constructor-this-store | III.1.8.1.4 | constructor-this-store-accept | constructor-this-store-reject | not run |
| constructor-this-use | III.1.8.1.4 | constructor-this-use-accept | constructor-this-use-reject | not run |
| ldftn-constructor | III.3.41 | ldftn-constructor-accept | ldftn-constructor-reject | not run |
| indirect-element-type | III.3.42 | indirect-element-type-accept | indirect-element-type-reject | not run |
| finite-float | III.3.24 | finite-float-accept | finite-float-reject | not run |
| managed-address | III.4.5 | managed-address-accept | managed-address-reject | not run |
| unverifiable-block-copy | III.3.30 | unverifiable-block-copy-accept | unverifiable-block-copy-reject | not run |
| array-instance | III.4.12 | array-instance-accept | array-instance-reject | not run |
| unbox-value-type | III.4.32 | unbox-value-type-accept | unbox-value-type-reject | not run |
| method-access | III.3.19 | method-access-accept | method-access-reject | not run |
| field-access | III.4.14 | field-access-accept | field-access-reject | not run |
| static-field-operand | III.4.14 | static-field-operand-accept | static-field-operand-reject | not run |
| initonly-write | III.4.28 | initonly-write-accept | initonly-write-reject | not run |
| callvirt-value-type | III.4.2 | callvirt-value-type-accept | callvirt-value-type-reject | not run |
| newobj-constructor | III.4.21 | newobj-constructor-accept | newobj-constructor-reject | not run |
| callvirt-static | III.4.2 | callvirt-static-accept | callvirt-static-reject | not run |
| call-existing-constructor | III.3.19 | call-existing-constructor-accept | call-existing-constructor-reject | not run |
| initlocals-required | III.1.8.1 | initlocals-required-accept | initlocals-required-reject | not run |
| tail-byref | III.2.4 | tail-byref-accept | tail-byref-reject | not run |
| tail-void-return | III.2.4 | tail-void-return-accept | tail-void-return-reject | not run |
| tail-return-type | III.2.4 | tail-return-type-accept | tail-return-type-reject | not run |
| tail-empty-stack | III.2.4 | tail-empty-stack-accept | tail-empty-stack-reject | not run |
| call-abstract | III.3.19 | call-abstract-accept | call-abstract-reject | not run |
| try-entry-stack | III.1.8.1 | try-entry-stack-accept | try-entry-stack-reject | not run |
| filter-exit-stack | III.3.34 | filter-exit-stack-accept | filter-exit-stack-reject | not run |
| box-byref | III.4.1 | box-byref-accept | box-byref-reject | not run |
| constrained-prefix | III.2.1 | constrained-prefix-accept | constrained-prefix-reject | not run |
| constrained-this-address | III.2.1 | constrained-this-address-accept | constrained-this-address-reject | not run |
| readonly-byref-write | III.1.8.1.2.2 | readonly-byref-write-accept | readonly-byref-write-reject | not run |
| unmanaged-pointer-type | III.1.8.1.2 | unmanaged-pointer-type-accept | unmanaged-pointer-type-reject | not run |
| delegate-method-pointer | III.1.8.1.5 | delegate-method-pointer-accept | delegate-method-pointer-reject | not run |
| type-access | III.4.3 | type-access-accept | type-access-reject | not run |
| newobj-abstract-method | III.4.21 | newobj-abstract-method-accept | newobj-abstract-method-reject | not run |
| catch-entry-stack | III.1.8.1 | catch-entry-stack-accept | catch-entry-stack-reject | not run |
| finally-entry-stack | III.1.8.1 | finally-entry-stack-accept | finally-entry-stack-reject | not run |
| delegate-ctor-pointer-signature | III.1.8.1.5 | delegate-ctor-pointer-signature-accept | delegate-ctor-pointer-signature-reject | not run |
| delegate-object-argument | III.1.8.1.5 | delegate-object-argument-accept | delegate-object-argument-reject | not run |
| generic-method-constraint | III.3.19 | generic-method-constraint-accept | generic-method-constraint-reject | not run |
| generic-field-owner-constraint | III.4.14 | generic-field-owner-constraint-accept | generic-field-owner-constraint-reject | not run |
| box-generic-constraint | III.4.1 | box-generic-constraint-accept | box-generic-constraint-reject | not run |
| newobj-abstract-class | III.4.21 | newobj-abstract-class-accept | newobj-abstract-class-reject | not run |
| delegate-nonfinal-virtual | III.3.41 | delegate-nonfinal-virtual-accept | delegate-nonfinal-virtual-reject | not run |

## Pinned upstream diagnostic inventory

| ILVerify diagnostic | Classification | Paired constraints |
| --- | --- | --- |
| UnknownOpcode | metadata-or-encoding | not a method-body verifiability rule |
| MethodFallthrough | partition-iii | method-fallthrough |
| FallthroughException | partition-iii | fallthrough-handler, fallthrough-filter |
| FallthroughIntoHandler | partition-iii | fallthrough-handler |
| FallthroughIntoFilter | partition-iii | fallthrough-filter |
| LeaveIntoTry | partition-iii | leave-into-try |
| LeaveIntoHandler | partition-iii | leave-into-handler |
| LeaveIntoFilter | partition-iii | leave-into-filter |
| LeaveOutOfFilter | partition-iii | leave-out-of-filter |
| LeaveOutOfFinally | partition-iii | leave-out-of-finally |
| LeaveOutOfFault | partition-iii | leave-out-of-fault |
| Rethrow | partition-iii | rethrow-handler |
| Endfinally | partition-iii | endfinally-handler |
| Endfilter | partition-iii | endfilter-region |
| BranchIntoTry | partition-iii | branch-into-try |
| BranchIntoHandler | partition-iii | branch-into-handler |
| BranchIntoFilter | partition-iii | branch-into-filter |
| BranchOutOfTry | partition-iii | branch-out-of-try, branch-into-handler, branch-into-filter |
| BranchOutOfHandler | partition-iii | branch-out-of-catch |
| BranchOutOfFilter | partition-iii | branch-out-of-filter |
| BranchOutOfFinally | partition-iii | branch-out-of-finally |
| ReturnFromTry | partition-iii | return-in-try |
| ReturnFromHandler | partition-iii | return-in-handler |
| ReturnFromFilter | partition-iii | return-in-filter |
| BadJumpTarget | partition-iii | prefix-branch-target |
| PathStackUnexpected | partition-iii | stack-merge-types |
| PathStackDepth | partition-iii | branch-stack-depth |
| ThisUninitStore | partition-iii | constructor-this-store |
| ThisUninitReturn | partition-iii | constructor-initialization |
| LdftnCtor | partition-iii | ldftn-constructor |
| StackUnexpected | partition-iii | return-type |
| StackUnexpectedArrayType | partition-iii | indirect-element-type |
| StackOverflow | partition-iii | stack-overflow |
| StackUnderflow | partition-iii | stack-underflow |
| UninitStack | partition-iii | constructor-this-use |
| ExpectedIntegerType | partition-iii | shift-count |
| ExpectedFloatType | partition-iii | finite-float |
| ExpectedNumericType | partition-iii | numeric-negation |
| StackObjRef | partition-iii | throw-reference |
| StackByRef | partition-iii | managed-address |
| StackMethod | partition-iii | delegate-method-pointer |
| UnrecognizedLocalNumber | partition-iii | local-index |
| UnrecognizedArgumentNumber | partition-iii | argument-index |
| ExpectedTypeToken | metadata-or-encoding | not a method-body verifiability rule |
| TokenResolve | metadata-or-encoding | not a method-body verifiability rule |
| ExpectedMethodToken | metadata-or-encoding | not a method-body verifiability rule |
| ExpectedFieldToken | metadata-or-encoding | not a method-body verifiability rule |
| Unverifiable | partition-iii | unverifiable-block-copy |
| StringOperand | metadata-or-encoding | not a method-body verifiability rule |
| ReturnPtrToStack | partition-iii | return-byref-lifetime |
| ReturnVoid | partition-iii | void-return |
| ReturnMissing | partition-iii | missing-return |
| ReturnEmpty | partition-iii | extra-return |
| ExpectedArray | partition-iii | array-instance |
| ValueTypeExpected | partition-iii | unbox-value-type |
| TypeAccess | partition-iii | type-access |
| MethodAccess | partition-iii | method-access |
| FieldAccess | partition-iii | field-access |
| ExpectedStaticField | partition-iii | static-field-operand |
| InitOnly | partition-iii | initonly-write |
| CallVirtOnValueType | partition-iii | callvirt-value-type |
| CtorExpected | partition-iii | newobj-constructor |
| CtorSig | partition-iii | newobj-abstract-method |
| ArrayByRef | metadata-or-encoding | not a method-body verifiability rule |
| ByrefOfByref | metadata-or-encoding | not a method-body verifiability rule |
| CodeSizeZero | metadata-or-encoding | not a method-body verifiability rule |
| TailCall | partition-iii | tail-next-instruction |
| TailByRef | partition-iii | tail-byref |
| TailRet | partition-iii | tail-return, tail-protected-region |
| TailRetVoid | partition-iii | tail-void-return |
| TailRetType | partition-iii | tail-return-type |
| TailStackEmpty | partition-iii | tail-empty-stack |
| MethodEnd | metadata-or-encoding | not a method-body verifiability rule |
| BadBranch | metadata-or-encoding | not a method-body verifiability rule |
| Volatile | partition-iii | volatile-prefix |
| Unaligned | partition-iii | unaligned-prefix |
| CallAbstract | partition-iii | call-abstract |
| TryNonEmptyStack | partition-iii | try-entry-stack |
| FilterOrCatchUnexpectedStack | partition-iii | catch-entry-stack |
| FinOrFaultNonEmptyStack | partition-iii | finally-entry-stack |
| DelegateCtor | partition-iii | delegate-signature |
| DelegatePattern | partition-iii | delegate-sequence |
| BoxByRef | partition-iii | box-byref |
| EndfilterStack | partition-iii | filter-exit-stack |
| DelegateCtorSigI | partition-iii | delegate-ctor-pointer-signature |
| DelegateCtorSigO | partition-iii | delegate-object-argument |
| CatchByRef | metadata-or-encoding | not a method-body verifiability rule |
| ThrowOrCatchOnlyExceptionType | optional-sanity | not a method-body verifiability rule |
| LdvirtftnOnStatic | partition-iii | ldvirtftn-static |
| CallVirtOnStatic | partition-iii | callvirt-static |
| InitLocals | partition-iii | initlocals-required |
| CallCtor | partition-iii | call-existing-constructor |
| ExpectedValClassObjRefVariable | partition-iii | box-byref |
| ReadOnly | partition-iii | readonly-prefix |
| Constrained | partition-iii | constrained-prefix |
| UnsatisfiedMethodInst | partition-iii | generic-method-constraint |
| UnsatisfiedMethodParentInst | partition-iii | generic-owner-constraint |
| UnsatisfiedFieldParentInst | partition-iii | generic-field-owner-constraint |
| UnsatisfiedBoxOperand | partition-iii | box-generic-constraint |
| ConstrainedCallWithNonByRefThis | partition-iii | constrained-this-address |
| ReadonlyUnexpectedCallee | partition-iii | readonly-callee |
| ReadOnlyIllegalWrite | partition-iii | readonly-byref-write |
| TailCallInsideER | partition-iii | tail-protected-region |
| BackwardBranch | partition-iii | backward-branch |
| NewobjAbstractClass | partition-iii | newobj-abstract-class |
| UnmanagedPointer | partition-iii | unmanaged-pointer-type |
| LdftnNonFinalVirtual | partition-iii | delegate-nonfinal-virtual |
| ThisMismatch | partition-iii | base-call-this |
| InterfaceImplHasDuplicate | metadata-or-encoding | not a method-body verifiability rule |
| InterfaceMethodNotImplemented | metadata-or-encoding | not a method-body verifiability rule |
| LocallocStackNotEmpty | instruction-correctness | not a method-body verifiability rule |
