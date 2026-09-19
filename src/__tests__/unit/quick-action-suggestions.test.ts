import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createQuickActionSuggestionsCache } from '../../lib/quick-action-suggestions';

it('cools down failures for one minute, then retries and caches success for ten minutes', async () => {
  let time = 0;
  let calls = 0;
  const cache = createQuickActionSuggestionsCache(() => time);
  const generate = async () => { if (++calls === 1) throw new Error('upstream failed'); return ['suggestion']; };
  assert.deepEqual(await cache.get('workspace', generate), []);
  time = 59_999;
  assert.deepEqual(await cache.get('workspace', generate), []);
  assert.equal(calls, 1);
  time = 60_000;
  assert.deepEqual(await cache.get('workspace', generate), ['suggestion']);
  assert.equal(calls, 2);
  time = 659_999;
  await cache.get('workspace', generate);
  assert.equal(calls, 2);
  time = 660_000;
  await cache.get('workspace', generate);
  assert.equal(calls, 3);
});

it('shares one pending request including failure, without waiting for the failure to start coalescing', async () => {
  let reject!: (error: Error) => void;
  let calls = 0;
  const cache = createQuickActionSuggestionsCache();
  const generate = () => { calls++; return new Promise<string[]>((_, no) => { reject = no; }); };
  const a = cache.get('a', generate);
  const b = cache.get('a', generate);
  await Promise.resolve();
  assert.equal(calls, 1);
  reject(new Error('failure'));
  assert.deepEqual(await Promise.all([a, b]), [[], []]);
  await cache.get('a', generate);
  assert.equal(calls, 1);
});

it('does not reuse another workspace suggestions or let a late completion replace the active workspace', async () => {
  const cache = createQuickActionSuggestionsCache();
  let resolve!: (value: string[]) => void;
  const old = cache.get('old', () => new Promise<string[]>((yes) => { resolve = yes; }));
  assert.deepEqual(await cache.get('new', async () => ['new suggestion']), ['new suggestion']);
  resolve(['old suggestion']);
  await old;
  assert.deepEqual(await cache.get('new', async () => { throw new Error('must use cache'); }), ['new suggestion']);
});

it('a no-credentials/empty result permits recovery after the short cooldown', async () => {
  let time = 0;
  const cache = createQuickActionSuggestionsCache(() => time);
  assert.deepEqual(await cache.get('a', async () => []), []);
  time = 60_000;
  assert.deepEqual(await cache.get('a', async () => ['configured now']), ['configured now']);
});
