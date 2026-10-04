/** Frame-local execution state. Compatible with debugger and portable snapshots. */
export function createExceptionState() {
  return {
    exception: null,
    pending: null,
    caught: [],
    unwinds: []
  };
}
