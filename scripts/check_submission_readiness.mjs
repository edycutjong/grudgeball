#!/usr/bin/env node
/**
 * check:submission — a pre-submission gate for the Grudgeball Devpost/Devvit
 * package. It is deliberately strict: it FAILS (exit 1) while the README or
 * DEMO still contain placeholder text, while any required README section is
 * missing, or while the two submission URLs (app listing + demo post) are
 * unfilled. That last one is expected to fail until AFTER you run
 * `devvit publish` and create the demo post — filling them is the last step.
 *
 * No dependencies; pure Node. Run: `npm run check:submission`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const issues = [];
const passes = [];
const fail = (m) => issues.push(m);
const pass = (m) => passes.push(m);

const read = (f) => (existsSync(resolve(root, f)) ? readFileSync(resolve(root, f), 'utf8') : null);

// 1. Required files.
for (const f of ['README.md', 'DEMO.md', 'devvit.json', 'package.json']) {
  if (existsSync(resolve(root, f))) pass(`file present: ${f}`);
  else fail(`missing required file: ${f}`);
}

const readme = read('README.md') ?? '';
const demo = read('DEMO.md') ?? '';

// 2. Required README sections.
const SECTIONS = [
  '## How to play',
  '## Architecture',
  '## Tests',
  '## Seeding',
  '## Anti-cheat',
  '## First playtest checklist',
  '## Submission checklist',
];
for (const s of SECTIONS) {
  // Headings may carry a leading emoji (e.g. "## 🕹️ How to play"), so match
  // "## " + any non-word lead-in (emoji/whitespace) + the required text,
  // rather than an exact substring.
  const heading = s.replace(/^##\s*/, '');
  const re = new RegExp(`^##\\s*\\S*\\s*${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm');
  if (re.test(readme)) pass(`README section present: ${s}`);
  else fail(`README missing required section: ${s}`);
}

// 3. Placeholder scan (README + DEMO). URL lines are checked separately in (4).
const PLACEHOLDER = /\bTODO\b|\bTBD\b|\bFIXME\b|\bPLACEHOLDER\b|\bXXX\b|\[N\]|<[A-Z][A-Z0-9_]{2,}>/;
const URL_LINE = /^\s*[-*]?\s*(App listing:|Demo post:)/i;
for (const [name, text] of [['README.md', readme], ['DEMO.md', demo]]) {
  if (text === '') continue;
  let found = false;
  text.split('\n').forEach((ln, i) => {
    if (URL_LINE.test(ln)) return; // covered by the dedicated URL check
    const m = PLACEHOLDER.exec(ln);
    if (m) {
      fail(`${name}:${i + 1} placeholder text "${m[0]}" → ${ln.trim().slice(0, 68)}`);
      found = true;
    }
  });
  if (!found) pass(`${name}: no placeholder text`);
}

// 4. Submission URLs must be resolved (not placeholders).
for (const label of ['App listing:', 'Demo post:']) {
  const re = new RegExp(`^\\s*[-*]?\\s*${label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*(\\S.*)$`, 'im');
  const m = re.exec(readme);
  if (m === null) {
    fail(`README "${label}" line missing from Submission checklist`);
    continue;
  }
  const val = m[1].trim();
  if (val === '' || /<[A-Z]|todo|tbd|fill\b|example\.com/i.test(val)) {
    fail(`README "${label}" is still a placeholder (${val || 'empty'}) — fill after publishing`);
  } else {
    pass(`README "${label}" resolved → ${val}`);
  }
}

// Report.
console.log('Grudgeball — submission readiness\n');
for (const p of passes) console.log(`  ok    ${p}`);
for (const i of issues) console.log(`  FAIL  ${i}`);
console.log('');
if (issues.length > 0) {
  console.log(`NOT READY — ${issues.length} issue(s) to resolve before submitting.`);
  process.exit(1);
}
console.log('READY — all submission checks passed.');
