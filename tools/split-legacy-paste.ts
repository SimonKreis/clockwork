/**
 * npm run split -- <pasted.md> <exportDir>
 *
 * Turns a page copied out of the legacy web interface back into the .feature files the converter
 * expects, one per suite.
 *
 * Why this exists. The supported way to get a legacy export is three files per suite: the .feature,
 * the object repository CSV and the data CSV. When nobody can produce those, the fallback is to
 * open each suite in the legacy platform and copy the page, which yields one document holding every suite in a row,
 * each wrapped in the interface's own furniture: a logo line, a details block, the words "Feature
 * file Steps", then the Gherkin, then a "Please Wait" that belongs to the page and not to the test.
 *
 * What is lost, stated plainly, because it decides how much the result can be trusted:
 *
 *   - **The object repository.** In practice almost nothing: the four exports measured during the design
 *     carry 302 object references and zero usable XPath, so the converter was already guessing the
 *     label from the object name in nearly every case. This makes that the only case.
 *   - **The data profile.** Real values are gone. The converter writes a stub listing the
 *     references the scenarios actually use, and every one of them has to be chosen once against
 *     the environment.
 *   - **Which scenarios were commented out in the legacy platform.** The interface does not show that, so every
 *     scenario here arrives enabled. A suite that was switched off in the legacy platform will look live.
 *
 * None of that is repairable from this side, and none of it is a reason not to convert: an inferred
 * label is exactly what assisted mode exists to correct, in ten seconds, in front of the tester.
 */

import fs from 'node:fs';
import path from 'node:path';

/** The interface's own furniture, which marks the seam between one suite and the next. */
const BLOCK_START = /^Logo\s*$/;
const NAME_HEADER = /^File Name\s*$/;
const STEPS_HEADER = /^Feature file Steps\s*$/;
const TAGS_HEADER = /^Feature tags\s*$/;
const TAGS_END = /^(Type|Uploaded On|Data|Objects|Source)\s*$/;

/** Lines the page adds that are not part of any test. */
const NOISE = /^(Please Wait\.*|-{3,}|Logo|Help.*|Loading .*)\s*$/;

type Block = { suite: string; tags: string[]; body: string[] };

function parse(text: string): Block[] {
  const lines = text.split(/\r?\n/);
  const blocks: Block[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!NAME_HEADER.test((lines[i] ?? '').trim())) continue;

    const raw = (lines[i + 1] ?? '').trim();
    if (!raw.toLowerCase().endsWith('.feature')) continue;
    const suite = path.basename(raw, '.feature');

    const tags: string[] = [];
    for (let j = i + 2; j < lines.length; j++) {
      const line = (lines[j] ?? '').trim();
      if (TAGS_HEADER.test(line)) continue;
      if (line.startsWith('@')) tags.push(line);
      if (TAGS_END.test(line)) break;
    }

    // The Gherkin runs from "Feature file Steps" to whatever starts the next suite.
    const from = lines.findIndex((l, k) => k > i && STEPS_HEADER.test((l ?? '').trim()));
    if (from < 0) continue;
    let to = lines.length;
    for (let j = from + 1; j < lines.length; j++) {
      if (BLOCK_START.test((lines[j] ?? '').trim())) {
        to = j;
        break;
      }
    }

    const body = lines
      .slice(from + 1, to)
      .map((l) => l.replace(/\s+$/, ''))
      .filter((l) => !NOISE.test(l.trim()));

    // Trim the blank lines the page leaves at both ends, without touching the middle.
    while (body.length && !(body[0] ?? '').trim()) body.shift();
    while (body.length && !(body[body.length - 1] ?? '').trim()) body.pop();

    if (body.some((l) => l.trim().startsWith('Scenario:'))) blocks.push({ suite, tags, body });
    i = to - 1;
  }

  return blocks;
}

function main(): void {
  const [input, outDir] = process.argv.slice(2);
  if (!input || !outDir) {
    console.error('Usage: npm run split -- <pasted.md> <exportDir>');
    console.error('Both paths are client material. Keep them out of this repository.');
    process.exit(1);
  }
  if (!fs.existsSync(input)) {
    console.error(`Not found: ${input}`);
    process.exit(1);
  }

  const blocks = parse(fs.readFileSync(input, 'utf8'));
  if (blocks.length === 0) {
    console.error(
      `No suite found in ${input}.\n` +
        `  Expected the shape the legacy page produces: a "File Name" line, the .feature name under\n` +
        `  it, and "Feature file Steps" before the Gherkin.`,
    );
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const used = new Set<string>();
  let scenarios = 0;

  for (const block of blocks) {
    // Two suites exported under one name would silently overwrite each other, and a lost suite is
    // invisible: the count still looks plausible. Number them instead.
    let suite = block.suite;
    for (let n = 2; used.has(suite); n++) suite = `${block.suite}_${n}`;
    used.add(suite);

    const count = block.body.filter((l) => l.trim().startsWith('Scenario:')).length;
    scenarios += count;

    const text = [
      ...block.tags,
      `Feature: ${block.suite}`,
      '',
      ...block.body,
      '',
    ].join('\n');

    fs.writeFileSync(path.join(outDir, `${suite}.feature`), text, 'utf8');
    console.log(`  ${suite}.feature  ${count} scenario(s)`);
  }

  console.log('');
  console.log(`${blocks.length} suite(s), ${scenarios} scenario(s) written to ${outDir}`);
  console.log('');
  console.log('No object repository and no data profile came with these, so every label will be');
  console.log('inferred from its legacy object name and every data value will need choosing once.');
  console.log('Next: npm run convert');
}

main();
