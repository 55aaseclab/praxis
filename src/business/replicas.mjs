export async function processReplicaJob({ events, repositories, prepareRepositories, signal }) {
  const job = events.claim();
  if (!job) return { state: events.status().state, processed: false };
  let previous;
  const timer = setInterval(() => events.renew(job), 30_000); timer.unref();
  try {
    if (prepareRepositories) repositories = await prepareRepositories();
    previous = repositories.activeAbortSignal; repositories.activeAbortSignal = signal;
    await repositories.snapshot();
    if (signal?.aborted) throw Object.assign(new Error('Operation aborted.'), { code: 'ABORTED' });
    const result = await repositories.sync();
    if (result.results?.some(target => target.status !== 'success')) throw Object.assign(new Error('Replicas are not synchronized.'), { code: result.results.some(target => target.status === 'unconfigured') ? 'NOT_CONFIGURED' : 'REPLICA_FAILED' });
    events.complete(job);
    return { state: events.status().state, processed: true };
  } catch (error) {
    events.retry(job, error.code === 'ABORTED' || signal?.aborted ? 'ABORTED' : error.code || 'REPLICA_FAILED');
    return { state: events.status().state, processed: true, code: error.code === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : signal?.aborted ? 'ABORTED' : 'REPLICA_FAILED' };
  } finally { clearInterval(timer); if (repositories) repositories.activeAbortSignal = previous; }
}
