import { beforeEach, describe, expect, it } from 'vitest';
import { demoFixture, FOUNDERS } from '../src/shared/fixtures/demoBoard';
import { yesterday } from '../src/shared/day';
import { keys } from '../src/server/core/keys';
import { readBoard } from '../src/server/core/boardRead';
import { readReport } from '../src/server/core/report';
import { seedDemoDay } from '../src/server/core/seed';
import { ALICE, TODAY } from './helpers/factories';
import { RedisStub } from './helpers/redisStub';

let stub: RedisStub;

beforeEach(() => {
  stub = new RedisStub();
});

describe('seedDemoDay', () => {
  it('seeds a byte-identical board on re-run (idempotent + deterministic)', async () => {
    const res1 = await seedDemoDay(stub, TODAY, null);
    const fixture = demoFixture();
    expect(res1).toEqual({
      status: 'ok',
      day: TODAY,
      objects: fixture.objects.length,
      trails: expect.any(Number),
      founders: FOUNDERS.length,
    });
    const snap1 = stub.snapshotKey(keys.board(TODAY));
    const res2 = await seedDemoDay(stub, TODAY, null);
    expect(res2.objects).toBe(res1.objects);
    expect(stub.snapshotKey(keys.board(TODAY))).toBe(snap1);

    const parsed = await readBoard(stub, TODAY);
    expect(parsed?.objects.length).toBe(fixture.objects.length);
  });

  it('populates yesterday\'s leaderboards and founder reports', async () => {
    await seedDemoDay(stub, TODAY, null);
    const yday = yesterday(TODAY);
    const menace = await stub.zRange(keys.lb('menace', yday), 0, -1, { by: 'rank' });
    expect(menace.length).toBeGreaterThan(0);
    const founder = FOUNDERS[0];
    if (founder === undefined) throw new Error('need a founder');
    const report = await readReport(stub, yday, founder.userId);
    expect(report).not.toBeNull();
  });

  it("seeds the invoker's demo report and clears their seen-marker", async () => {
    await stub.hSet(keys.user(ALICE.userId, TODAY), { lastReportSeen: yesterday(TODAY) });
    await seedDemoDay(stub, TODAY, ALICE);
    const yday = yesterday(TODAY);
    const report = await readReport(stub, yday, ALICE.userId);
    expect(report).not.toBeNull();
    expect(report?.kills).toBeGreaterThan(0);
    expect(await stub.hGet(keys.user(ALICE.userId, TODAY), 'lastReportSeen')).toBeUndefined();
  });

  it('without an invoker, no invoker-specific report is written', async () => {
    await seedDemoDay(stub, TODAY, null);
    const yday = yesterday(TODAY);
    expect(await readReport(stub, yday, ALICE.userId)).toBeNull();
  });
});
