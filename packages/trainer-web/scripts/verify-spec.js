/*
 * Prove that docs/spec.md says exactly what the recovered specification says.
 *
 * The spec was lost once and rebuilt from a transcript. The rule for that
 * rebuild was that no word may change — only ligatures, page markers, line
 * wrapping and markdown punctuation. This checks that claim rather than
 * repeating it: both sides are reduced to a bare sequence of words and compared
 * token by token.
 *
 *   node packages/trainer-web/scripts/verify-spec.js <recovered.txt>
 *
 * The recovered text is the export's section 2, which is itself the transcript
 * record of the original PDF extraction.
 */
import { readFileSync } from 'node:fs';

const LIGATURES = { 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'ft', 'ﬆ': 'st' };

/** Everything that is not a word: markers, markdown punctuation, whitespace. */
function words(text) {
  let s = text;
  for (const [lig, letters] of Object.entries(LIGATURES)) s = s.split(lig).join(letters);
  return s
    .replace(/^===== PAGE \d+ =====$/gm, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ') // the [extraction artefact] notes
    .replace(/^```\w*$/gm, ' ') // code fences
    .replace(/^\s*[-*]\s+/gm, ' ') // bullets
    .replace(/^#{1,6}\s+/gm, ' ') // headings
    .replace(/^>\s?/gm, ' ') // blockquote (the header note)
    .replace(/[`*_]/g, ' ') // inline emphasis
    // The §12 architecture drawing. Box-drawing characters are decoration, and
    // the PDF wrapped every row of it in half — so the fragments differ between
    // the two sides while the labels inside the boxes, which are the actual
    // text, still have to match exactly.
    .replace(/[┌┐└┘│─▼├┤┬┴┼·]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

const recoveredPath = process.argv[2];
if (!recoveredPath) {
  console.error('usage: verify-spec.js <recovered-spec.txt>');
  process.exit(2);
}

const md = readFileSync('docs/spec.md', 'utf8');
// The front-matter note is this file's own writing, not the spec's; the spec
// starts at the first horizontal rule.
const bodyStart = md.indexOf('\n---\n');
const body = bodyStart >= 0 ? md.slice(bodyStart + 5) : md;

const mine = words(body);
const theirs = words(readFileSync(recoveredPath, 'utf8'));

let i = 0;
while (i < mine.length && i < theirs.length && mine[i] === theirs[i]) i++;

if (mine.length === theirs.length && i === mine.length) {
  console.log(`MATCH — ${mine.length} words, identical in sequence.`);
  process.exit(0);
}

console.log(`MISMATCH at word ${i} of ${theirs.length}`);
console.log(`  docs/spec.md : ${mine.slice(Math.max(0, i - 6), i + 6).join(' ')}`);
console.log(`  recovered    : ${theirs.slice(Math.max(0, i - 6), i + 6).join(' ')}`);
console.log(`  lengths: spec.md ${mine.length}, recovered ${theirs.length}`);
process.exit(1);
