function interruption(code, message) {
  return Object.assign(new Error(message), { code });
}

export class ReductionBudgetExceeded extends Error {
  constructor() {
    super('Reduction observation exceeded the time budget');
    this.code = 'budget-exceeded';
  }
}

/**
 * Bound asynchronous waiting in milliseconds; reject on timeout or cancellation.
 * The signal requests cleanup but cannot preempt synchronous or uncooperative work.
 */
export async function observeWithinBudget(fixture, observe, { signal, timeoutMs }) {
  if (signal?.aborted) throw interruption('cancelled', 'Reduction cancelled');
  const controller = new AbortController();
  let timer;
  let abort;
  const interrupted = new Promise((_resolve, reject) => {
    abort = () => {
      reject(interruption('cancelled', 'Reduction cancelled'));
      controller.abort();
    };
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => {
      reject(new ReductionBudgetExceeded());
      controller.abort();
    }, timeoutMs);
  });
  try {
    const observation = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw interruption('cancelled', 'Reduction cancelled');
      return observe(fixture, { signal: controller.signal });
    });
    return await Promise.race([observation, interrupted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
