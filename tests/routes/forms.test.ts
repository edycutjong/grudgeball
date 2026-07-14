import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisStub } from '../helpers/redisStub';
import { NOW, openCellsFor, queueDirect, TARGET } from '../helpers/factories';
import { keys } from '../../src/server/core/keys';

let redis = new RedisStub();
const mockContext: { userId: string | undefined } = { userId: undefined };
const getCurrentUsername = vi.fn(async (..._args: unknown[]) => undefined as string | undefined);
const realtimeSend = vi.fn(async (..._args: unknown[]) => {});

vi.mock('@devvit/web/server', () => ({
  context: mockContext,
  get redis() {
    return redis;
  },
  reddit: { getCurrentUsername: (...a: unknown[]) => getCurrentUsername(...a) },
  realtime: { send: (...a: unknown[]) => realtimeSend(...a) },
}));

const { forms } = await import('../../src/server/routes/forms');

beforeEach(() => {
  redis = new RedisStub();
  vi.setSystemTime(NOW);
  mockContext.userId = undefined;
  getCurrentUsername.mockReset();
  getCurrentUsername.mockResolvedValue(undefined);
  realtimeSend.mockReset();
  realtimeSend.mockResolvedValue(undefined);
});

describe('POST /purge-submit', () => {
  it('purges a matched object and broadcasts, attributing the resolved username', async () => {
    getCurrentUsername.mockResolvedValue('modAlice');
    const cell = openCellsFor(TARGET)[0];
    if (cell === undefined) throw new Error('need cell');
    await queueDirect(redis, TARGET, { id: 'q1', type: 'spike', cell, name: 'Bad Trap' });
    const res = await forms.request('/purge-submit', {
      method: 'POST',
      body: JSON.stringify({ ident: 'q1' }),
    });
    const body = await res.json();
    expect(body.showToast).toContain('Purged');
    expect(realtimeSend).toHaveBeenCalledOnce();
    expect(await redis.hGet(keys.queued(TARGET), 'q1')).toBeUndefined();
  });

  it("falls back to context.userId when getCurrentUsername resolves undefined", async () => {
    mockContext.userId = 't2_fallback';
    const res = await forms.request('/purge-submit', {
      method: 'POST',
      body: JSON.stringify({ ident: 'nonexistent' }),
    });
    const body = await res.json();
    expect(body.showToast).toContain('No object matched');
  });

  it('reports no match without crashing when nothing matches', async () => {
    const res = await forms.request('/purge-submit', {
      method: 'POST',
      body: JSON.stringify({ ident: 'ghost' }),
    });
    const body = await res.json();
    expect(body.showToast).toContain('No object matched "ghost"');
  });

  it('tolerates an unparsable JSON body (empty ident)', async () => {
    const res = await forms.request('/purge-submit', { method: 'POST', body: 'not json' });
    const body = await res.json();
    expect(body.showToast).toContain('No object matched ""');
  });

  it('is non-fatal if the purge realtime broadcast throws', async () => {
    const cell = openCellsFor(TARGET)[0];
    if (cell === undefined) throw new Error('need cell');
    await queueDirect(redis, TARGET, { id: 'q1', type: 'spike', cell, name: 'Bad Trap' });
    realtimeSend.mockRejectedValue(new Error('down'));
    const res = await forms.request('/purge-submit', {
      method: 'POST',
      body: JSON.stringify({ ident: 'q1' }),
    });
    const body = await res.json();
    expect(body.showToast).toContain('Purged');
  });

  it('returns a 400 error toast if purgeObject itself throws', async () => {
    redis = { hGetAll: () => Promise.reject(new Error('down')) } as unknown as RedisStub;
    const res = await forms.request('/purge-submit', {
      method: 'POST',
      body: JSON.stringify({ ident: 'q1' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.showToast).toContain('Purge failed');
  });
});
