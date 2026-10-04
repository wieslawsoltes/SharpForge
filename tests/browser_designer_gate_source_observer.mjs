/** Bounded listeners only observe the real production Worker; they never replace handlers or delay a request. */
export async function observeCompilerRequests(worker, uri) {
  await worker.evaluate(uri => {
    const data = {events: [], dropped: 0, timeOrigin: performance.timeOrigin};
    const listener = event => {
      const message = event.data;
      if (message?.method !== 'cancelRequest' && !(message?.method === 'designAnalyze' && message.params?.uri === uri)) return;
      if (data.events.length === 64) { data.dropped++; return; }
      const file = message.params.files?.find(file => file.uri === uri);
      data.events.push({time: performance.now(), method: message.method, id: message.id ?? null,
        requestId: message.params.requestId ?? null, operation: message.params.operation ?? null,
        generation: message.params.generation ?? null, revision: message.params.revision ?? null,
        owner: message.params.requestOwner ?? null, sourceVersion: file?.version ?? null, sourceText: file?.text ?? null});
    };
    self.addEventListener('message', listener);
    self.__a18CompilerObservation = {data, stop() {
      self.removeEventListener('message', listener);
      delete self.__a18CompilerObservation;
      return data;
    }};
  }, uri);
}

/** Capture the browser event timestamp at the editor, before its application handler; driver round trips are never substituted. */
export async function observeSourceInput(page, uri) {
  await page.evaluate(uri => {
    const host = document.querySelector(`[data-designer-document="${uri}"]`);
    const editor = host.querySelector('textarea.sf-input');
    const preview = host.querySelector('.design-preview');
    if (!editor || !preview) throw new Error('The source latency case needs the real split editor and design preview.');
    const data = {uri, keys: [], inputs: [], snapshots: [], requests: [], dropped: 0, timeOrigin: performance.timeOrigin};
    const append = (field, value) => {
      if (data[field].length < 256) data[field].push(value);
      else data.dropped++;
    };
    const sample = () => {
      const value = sharpforge.designerDocuments.get(uri);
      const file = sharpforge.getState().files.find(file => file.uri === uri);
      const snapshot = {time: performance.now(), documentRevision: value.revision, sourceVersion: file.version,
        content: value.document.nodes.find(node => node.id === 'action')?.properties.Content, syncState: value.sourceSync.state};
      append('snapshots', snapshot);
      return snapshot;
    };
    const input = event => {
      const capturedAt = performance.now();
      const timestamp = event.timeStamp > performance.timeOrigin ? event.timeStamp - performance.timeOrigin : event.timeStamp;
      append(event.type === 'keydown' ? 'keys' : 'inputs', {type: event.type, key: event.key ?? null, inputType: event.inputType ?? null,
        trusted: event.isTrusted, rawEventTimestamp: event.timeStamp, eventTimestamp: timestamp,
        capturedAt, queueDelayMs: capturedAt - timestamp,
        pending: data.requests.filter(request => request.status === 'pending').map(request => request.label)});
    };
    editor.addEventListener('keydown', input, true);
    // The editor consumes cancelable beforeinput and updates its model without a native input event.
    editor.addEventListener('beforeinput', input, true);
    editor.addEventListener('input', input, true);
    const observer = new MutationObserver(sample);
    observer.observe(preview, {childList: true, characterData: true, subtree: true});
    window.__a18SourceObservation = {data, sample, start(label) {
      if (data.requests.length >= 8 || data.requests.some(request => request.label === label)) throw new Error('Duplicate or excessive analysis request.');
      const file = sharpforge.getState().files.find(file => file.uri === uri);
      const request = {label, started: performance.now(), status: 'pending', sourceVersion: file.version, sourceText: file.text};
      data.requests.push(request);
      sharpforge.designer.readSource().then(result => {
        Object.assign(request, {status: 'fulfilled', completed: performance.now(), result, acceptedPreview: sample()});
      }, error => {
        Object.assign(request, {status: 'rejected', completed: performance.now(),
          error: {name: error.name, code: error.code, message: error.message}, rejectedPreview: sample()});
      });
      return {label, started: request.started, sourceVersion: request.sourceVersion};
    }, stop() {
      observer.disconnect();
      editor.removeEventListener('keydown', input, true);
      editor.removeEventListener('beforeinput', input, true);
      editor.removeEventListener('input', input, true);
      sample();
      delete window.__a18SourceObservation;
      return data;
    }};
    sample();
  }, uri);
}

export async function collectSourceObservations(page, worker) {
  const observations = await Promise.allSettled([
    page.evaluate(() => window.__a18SourceObservation?.stop() ?? null),
    worker.evaluate(() => self.__a18CompilerObservation?.stop() ?? null)
  ]);
  const read = result => result.status === 'fulfilled' ? result.value : {error: result.reason.message};
  return {input: read(observations[0]), worker: read(observations[1])};
}
