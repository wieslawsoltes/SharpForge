/** These identical programs are consumed by the source, reloaded, CLI and native runners. */
export const memorySourceCases = [
  {
    name: 'rectangular ranks and dimensions',
    source: 'int[,] a=new int[2,3];a[1,2]=17;a[1,2]+=4;Console.WriteLine(a[1,2]);' +
      'Console.WriteLine(a.Rank);Console.WriteLine(a.Length);Console.WriteLine(a.GetLength(0));' +
      'Console.WriteLine(a.GetLength(1));int[,,] b=new int[2,3,4];b[1,2,3]=31;Console.WriteLine(b[1,2,3]);',
    output: '21\n2\n6\n2\n3\n31\n',
  },
  {
    name: 'nested initializer and zero dimension',
    source: 'long[,] a=new long[,]{{1L,2L},{3L,9223372036854775807L}};' +
      'Console.WriteLine(a[1,1]);int[,,] empty=new int[2,0,4];Console.WriteLine(empty.Length);' +
      'Console.WriteLine(empty.GetLength(2));',
    output: '9223372036854775807\n0\n4\n',
  },
  {
    name: 'rectangular per dimension bounds',
    source: 'int[,] a=new int[2,3];try{Console.WriteLine(a[0,3]);}' +
      'catch(Exception e){Console.WriteLine(e.GetType().Name);}' +
      'try{a[-1,0]=3;}catch(Exception e){Console.WriteLine(e.GetType().Name);}',
    output: 'IndexOutOfRangeException\nIndexOutOfRangeException\n',
  },
  {
    name: 'stackalloc initializer slices share writes',
    source: 'Span<int> s=stackalloc int[4]{10,20,30,40};Span<int> tail=s.Slice(1,2);' +
      'tail[1]+=5;Console.WriteLine(s[2]);Console.WriteLine(tail.Length);' +
      'Console.WriteLine(s.Slice(4).Length);ReadOnlySpan<int> view=s;Console.WriteLine(view[3]);' +
      'Console.WriteLine(view.Slice(1)[0]);',
    output: '35\n2\n0\n40\n20\n',
  },
  {
    name: 'stackalloc exact widths and empty defaults',
    source: 'Span<ulong> s=stackalloc ulong[]{18446744073709551615UL,1UL};' +
      'Console.WriteLine(s[0]);s[1]=s[0];Console.WriteLine(s[1]);' +
      'Span<int> empty=default(Span<int>);ReadOnlySpan<int> ro=new ReadOnlySpan<int>();' +
      'Console.WriteLine(empty.Length);Console.WriteLine(ro.Length);' +
      'Span<int> allocated=stackalloc int[0];Console.WriteLine(allocated.Length);',
    output: '18446744073709551615\n18446744073709551615\n0\n0\n0\n',
  },
  {
    name: 'span index and slice bounds',
    source: 'Span<int> s=stackalloc int[1];try{Console.WriteLine(s[1]);}' +
      'catch(Exception e){Console.WriteLine(e.GetType().Name);}' +
      'try{s[-1]=5;}catch(Exception e){Console.WriteLine(e.GetType().Name);}' +
      'try{s.Slice(2);}catch(Exception e){Console.WriteLine(e.GetType().Name);}',
    output: 'IndexOutOfRangeException\nIndexOutOfRangeException\nArgumentOutOfRangeException\n',
  },
];
