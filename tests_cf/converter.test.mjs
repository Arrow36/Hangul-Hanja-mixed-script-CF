import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { convert } from './converter.bundle.mjs';

const cases = JSON.parse(fs.readFileSync(new URL('./regression.json', import.meta.url), 'utf8'));
const collocations = JSON.parse(fs.readFileSync(new URL('../public/static/collocations.json', import.meta.url), 'utf8'));

test('fixed-token examples preserve text spans and exactly match Python output', async () => {
  assert.ok(cases.length >= 42, 'regression corpus shrank');
  const differences = [];
  for (const item of cases) {
    const segments = await convert(item.text, item.tokens, async words =>
      Object.fromEntries(words.map(word => [word, item.candidates[word] ?? []])), collocations,
      async words => Object.fromEntries(words.map(word => [word, []])));
    assert.equal(segments.map(s => s.original).join(''), item.text, `offset preservation: ${item.text}`);
    const display = segments.map(s => s.display_text).join('');
    if (display !== item.python_display) differences.push({ input:item.text, python:item.python_display, cloudflare:display });
  }
  fs.writeFileSync(new URL('./differences.json', import.meta.url), JSON.stringify(differences,null,2));
  console.log(`Python/TS display matches: ${cases.length-differences.length}/${cases.length}`);
  assert.deepEqual(differences, [], 'fixed-token conversion parity regressed');
});
