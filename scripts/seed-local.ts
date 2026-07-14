/**
 * seed:local — regenerate the deterministic demo-board fixture snapshot.
 *
 * The in-APP seed path is the moderator "Seed Demo Day" menu action, which
 * writes the 60-object founder board straight into Redis (src/server/core/
 * seed.ts). This script is its offline twin: it materializes the same
 * hand-placed fixture (src/shared/fixtures/demoBoard.ts) to
 * data/fixtures/demo-board.json so the seed data is inspectable in the repo
 * and diffable in review. It also asserts the fixture is byte-deterministic
 * (generate twice → identical), which is the property the live seed relies on.
 *
 * Run: `npm run seed:local`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoFixture, demoTrails, FOUNDERS } from '../src/shared/fixtures/demoBoard';

function snapshot(): string {
  const fixture = demoFixture();
  const trails = demoTrails(fixture.trailSeed);
  return JSON.stringify({ ...fixture, trails }, null, 2);
}

const first = snapshot();
const second = snapshot();
if (first !== second) {
  console.error('seed:local FAILED — demo fixture is not deterministic.');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../data/fixtures/demo-board.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${first}\n`);

const fixture = demoFixture();
const trails = demoTrails(fixture.trailSeed);
const kills = fixture.objects.reduce((n, o) => n + o.kills, 0);
const saves = fixture.objects.reduce((n, o) => n + o.saves, 0);

console.log(`seed:local → ${outPath}`);
console.log(`  ${fixture.objects.length} objects · ${trails.length} ghost trails · ${FOUNDERS.length} founders`);
console.log(`  seeded counters: ${kills} kills / ${saves} saves · headline killer "${fixture.yesterdayReport.deadliestName}" (${fixture.yesterdayReport.deadliestKills})`);
console.log('  deterministic: OK (generated twice, byte-identical)');
console.log('  in-app equivalent: moderator menu → "Grudgeball: Seed Demo Day"');
