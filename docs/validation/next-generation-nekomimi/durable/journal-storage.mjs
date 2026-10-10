import { MemoryStorage } from '@earendil-works/pi-durable/storage/memory';

/** 验证切片：仅通过公开API将Durable提交映射到产品Journal；不是生产服务入口。 */
export async function openJournalStorage(directory, context, { journalModule, journalOptions = {} } = {}) {
  const { Journal } = await import(journalModule);
  const journal = await Journal.open(directory, journalOptions);
  const memory = new MemoryStorage();
  let fault;
  let closed = false;
  let tail = Promise.resolve();
  const mappings = [];
  try {
    for (const event of journal.events) {
      if (event.seq > journal.durableSeq || event.type !== 'durable.commit') continue;
      const batch = event.payload;
      if (batch.formatVersion !== 1 || batch.adapterRevision !== 'journal-storage-slice-1') throw new Error('Unsupported Durable journal batch');
      const prepared = memory.prepareCommit(batch.writes, batch.frameworkSeq);
      prepared.apply();
      mappings.push({ frameworkSeq: batch.frameworkSeq, journalSeq: event.seq });
    }
  } catch (error) {
    await memory.close(context);
    await journal.close();
    throw error;
  }
  const check = () => {
    if (closed) throw new Error('Durable Journal storage closed');
    if (fault || journal.failure.signal.aborted) throw new Error('Durable Journal storage poisoned', { cause: fault ?? journal.failure.signal.reason });
  };
  const commit = (writes, commitContext) => {
    // Detach at admission so caller mutation while a prior commit waits cannot change this batch.
    const detached = structuredClone(writes);
    const task = tail.then(async () => {
      check();
      const prepared = memory.prepareCommit(detached);
      const batch = { formatVersion: 1, adapterRevision: 'journal-storage-slice-1', frameworkSeq: prepared.seq, writes: prepared.writes };
      // Replacing credentials inside framework state would corrupt its projection: reject instead.
      const encoded = JSON.stringify(batch);
      if (journal.clean(encoded) !== encoded) throw new Error('Credential-bearing Durable batch rejected');
      try {
        const event = await journal.append('durable.commit', batch);
        const seq = prepared.apply();
        mappings.push({ frameworkSeq: seq, journalSeq: event.seq });
        return seq;
      } catch (error) {
        fault = error;
        throw error;
      }
    });
    tail = task.catch(() => {});
    return task;
  };
  const storage = new Proxy(memory, {
    get(target, property) {
      if (property === 'commit') return commit;
      if (property === 'close') return async closeContext => {
        if (closed) return;
        closed = true;
        await tail;
        try { await memory.close(closeContext); } finally { await journal.close(); }
      };
      const value = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      // All other exposed methods are public Storage reads / ID allocation.
      if (property === 'prepareCommit') return undefined;
      return (...args) => { check(); return value.apply(target, args); };
    },
  });
  return { storage, journal, mappings };
}
