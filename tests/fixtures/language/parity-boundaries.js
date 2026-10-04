/** Cross-engine error observables and boundary values absent from output-only catalogs. */
export const languageFixtures=[
  {id:'parity/negative exit code',source:'class P { static int Main(){return -3;} }',expected:{output:'',exitCode:-3}},
  {id:'parity/minimum exit code',source:'class P { static int Main(){return -2147483648;} }',expected:{output:'',exitCode:-2147483648}},
  {id:'parity/maximum exit code',source:'class P { static int Main(){return 2147483647;} }',expected:{output:'',exitCode:2147483647}},
  {id:'parity/uncaught divide by zero',source:'Console.WriteLine("before");int zero=0;Console.WriteLine(1/zero);',expected:{state:'faulted',output:'before\n',exceptionType:'System.DivideByZeroException'}},
  {id:'parity/uncaught checked overflow',source:'int maximum=2147483647;Console.WriteLine(checked(maximum+1));',expected:{state:'faulted',output:'',exceptionType:'System.OverflowException'}},
  {id:'parity/uncaught array boundary',source:'int[] values=new int[0];Console.WriteLine(values[0]);',expected:{state:'faulted',output:'',exceptionType:'System.IndexOutOfRangeException'}},
  {id:'parity/uncaught user exception',source:'throw new Exception("failure");',expected:{state:'faulted',output:'',exceptionType:'System.Exception'}},
  {id:'parity/output budget boundary',source:'Console.WriteLine("four");',runtimeOptions:{maxOutputCharacters:3},
    expected:{state:'faulted',output:'',exceptionType:'System.ExecutionEngineException',diagnosticName:'OutputLimitException'}},
  {id:'parity/instruction budget boundary',source:'while(true){}',runtimeOptions:{maxInstructions:64},
    expected:{state:'faulted',output:'',exceptionType:'System.ExecutionEngineException',diagnosticName:'InstructionLimitException'}},
  {id:'parity/UTF16 output boundary',source:'Console.WriteLine("A😀Z");',expected:{output:'A😀Z\n'}},
  {id:'parity/multiple files',source:[{uri:'Program.cs',text:'Console.WriteLine(Value.Read());'},{uri:'Value.cs',text:'class Value { public static int Read()=>42; }'}],expected:{output:'42\n'}}
];
