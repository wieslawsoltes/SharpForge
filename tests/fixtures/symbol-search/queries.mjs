export const queries = [
  { name: 'prefix-late', query: 'SearchType4999', mode: 'prefix', count: 10 },
  { name: 'prefix-miss', query: 'AbsentType', mode: 'prefix', count: 0 },
  { name: 'substring-late', query: 'Type4999', mode: 'substring', count: 10 },
  { name: 'substring-miss', query: 'AbsentType', mode: 'substring', count: 0 },
  { name: 'camel-late', query: 'ST4', mode: 'camel', offset: 9990, count: 10 },
  { name: 'camel-miss', query: 'ZZ', mode: 'camel', count: 0 },
];

export function checkResult(result, item) {
  if (result.entries.length !== item.count || result.entries.length > 37 || result.nextOffset !== null || result.capped)
    throw Error('Unexpected bounded result for ' + item.name);
  if (item.count && (result.entries[0].token !== 0x02000002 + 49990 || result.entries.at(-1).token !== 0x02000002 + 49999))
    throw Error('Unexpected late-match identity for ' + item.name);
}
