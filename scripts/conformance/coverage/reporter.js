/** Machine-readable Node test reporter. A failed run still retains its coverage. */
export default async function* reporter(events) {
  for await (const {type, data} of events) {
    if (type === 'test:coverage') yield JSON.stringify({type, data}) + '\n';
    if (type === 'test:summary' && !data.file) yield JSON.stringify({type, data}) + '\n';
    if (type === 'test:fail') yield JSON.stringify({type, data: {name: data.name, file: data.file, message: data.details?.error?.message}}) + '\n';
  }
}
