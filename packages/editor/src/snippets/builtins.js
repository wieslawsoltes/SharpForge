export const CSHARP_SNIPPETS = Object.freeze([
  {prefix: 'prop', label: 'Auto property', body: 'public ${1:int} ${2:MyProperty} { get; set; }$0'},
  {prefix: 'ctor', label: 'Constructor', body: 'public ${1:ClassName}(${2})\n{\n    $0\n}'},
  {prefix: 'for', label: 'For loop', body: 'for (int ${1:i} = 0; $1 < ${2:length}; $1++)\n{\n    $0\n}'},
  {prefix: 'foreach', label: 'For each loop', body: 'foreach (${1:var} ${2:item} in ${3:collection})\n{\n    $0\n}'},
  {prefix: 'if', label: 'If statement', body: 'if (${1:condition})\n{\n    $TM_SELECTED_TEXT$0\n}', surround: true},
  {prefix: 'try', label: 'Try catch', body: 'try\n{\n    $TM_SELECTED_TEXT\n}\ncatch (${1:Exception} ${2:exception})\n{\n    $0\n}', surround: true},
  {prefix: 'cw', label: 'Console.WriteLine', body: 'Console.WriteLine(${1});$0'},
  {prefix: 'class', label: 'Class', body: '${1|public,internal|} class ${2:ClassName}\n{\n    $0\n}'},
  {prefix: 'region', label: 'Region', body: '#region ${1:Name}\n$TM_SELECTED_TEXT\n#endregion$0', surround: true},
  {prefix: 'using', label: 'Using statement', body: 'using (${1:var resource = expression})\n{\n    $TM_SELECTED_TEXT$0\n}', surround: true}
]);
