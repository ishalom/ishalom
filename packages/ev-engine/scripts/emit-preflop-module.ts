/**
 * Turn the solved pre-flop table into a module the browser can hold.
 *
 * `assets/uth-preflop.json` is the output of `generate-preflop.ts`, which takes
 * hours and runs offline. Reading it at runtime is fine in Node and impossible
 * in the shared build: `scripts/bundle.ts` drops `node:` specifiers, so a
 * `readFileSync` would survive as an undeclared name and the build's own guard
 * would — correctly — refuse the page.
 *
 * So the table is emitted as source. One module, imported like any other, with
 * nothing to fetch and nothing to fail at runtime. `test/uth-preflop.test.ts`
 * holds the two copies to each other, so regenerating one and forgetting the
 * other is a failing test rather than a page that grades from stale numbers.
 *
 *   node scripts/emit-preflop-module.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..');

interface Row {
  label: string;
  ev4x: number;
  ev3x: number;
  evCheck: number;
  optimalAction: string;
  margin: number;
  flopRaiseFrequency: number;
  riverFoldFrequency: number;
  /* What the enumeration counted on the way (round 20). Absent in a table
     solved before the counters existed, and then the card simply says less. */
  wins?: number;
  losses?: number;
  winSide?: number;
  side?: number;
  flops?: number;
  flopRaises?: number;
  flopRaiseValue?: number;
  flopCheckValue?: number;
  /* The check branch's endings and what they are worth (round 28). */
  checkWins?: number;
  checkTies?: number;
  checkLosses?: number;
  checkWinUnits?: number;
  checkLossUnits?: number;
  checkOutcomes?: number;
}

interface Asset {
  generatedWith: string;
  blindPaytable: string;
  classes: Record<string, Row>;
}

const asset = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, 'assets', 'uth-preflop.json'), 'utf8'),
) as Asset;

const labels = Object.keys(asset.classes);
if (labels.length !== 169) {
  throw new Error(`Expected 169 solved classes, found ${labels.length}`);
}

/**
 * One line per class, in the order the solver wrote them.
 *
 * Full precision, deliberately: the numbers are the engine's and nothing here
 * is entitled to round them. `JSON.stringify` of a double round-trips exactly,
 * so the module holds the same values the solver produced.
 */
const rows = labels
  .map((label) => {
    const row = asset.classes[label]!;
    const fields = [
      `ev4x: ${row.ev4x}`,
      `ev3x: ${row.ev3x}`,
      `evCheck: ${row.evCheck}`,
      `optimalAction: ${JSON.stringify(row.optimalAction)}`,
      `margin: ${row.margin}`,
      `flopRaiseFrequency: ${row.flopRaiseFrequency}`,
      `riverFoldFrequency: ${row.riverFoldFrequency}`,
      ...(row.wins === undefined
        ? []
        : [
            `wins: ${row.wins}`,
            `losses: ${row.losses}`,
            `winSide: ${row.winSide}`,
            `side: ${row.side}`,
            `flops: ${row.flops}`,
            `flopRaises: ${row.flopRaises}`,
            `flopRaiseValue: ${row.flopRaiseValue}`,
            `flopCheckValue: ${row.flopCheckValue}`,
          ]),
    /*
     * The check branch's own endings (round 28), emitted separately because a
     * table solved before them has the fields above and not these — and a
     * missing counter must read as "not counted" rather than as zero.
     */
    ...(row.checkWins === undefined
      ? []
      : [
          `checkWins: ${row.checkWins}`,
          `checkTies: ${row.checkTies}`,
          `checkLosses: ${row.checkLosses}`,
          `checkWinUnits: ${row.checkWinUnits}`,
          `checkLossUnits: ${row.checkLossUnits}`,
          `checkOutcomes: ${row.checkOutcomes}`,
        ]),
    ].join(', ');
    return `  ${JSON.stringify(label)}: { label: ${JSON.stringify(label)}, ${fields} },`;
  })
  .join('\n');

const source = `/**
 * The solved pre-flop table: all 169 hole-card classes.
 *
 * GENERATED FILE — do not edit. Produced by \`scripts/emit-preflop-module.ts\`
 * from \`assets/uth-preflop.json\`, which \`scripts/generate-preflop.ts\` takes
 * hours to compute. \`test/uth-preflop.test.ts\` checks the two agree.
 *
 * It is source rather than an asset because the shared build has no runtime to
 * read a file with, and because grading from a table that might not have loaded
 * is worse than not grading at all.
 *
 * Solved against the **${asset.blindPaytable}** blind paytable and no other.
 * Offering a second paytable means re-running the offline job, not flipping a
 * switch, so nothing in the app may present the paytable as configurable.
 */

/** What the solver knows about one of the 169 starting classes. */
export interface PreflopRow {
  /** Canonical class label: AA, AKs, AKo. */
  label: string;
  /** EV of raising 4x before the flop, in units of the ante. */
  ev4x: number;
  /** EV of raising 3x. Spec §5.2.3: never the best of the three. */
  ev3x: number;
  /** EV of checking, then playing the flop and river correctly. */
  evCheck: number;
  optimalAction: 'raise4x' | 'raise3x' | 'check';
  /** What the second-best choice gives up, in units. */
  margin: number;
  /** How often a checked hand goes on to raise the flop. */
  flopRaiseFrequency: number;
  /** How often a checked hand goes on to fold the river. */
  riverFoldFrequency: number;

  /*
   * What the enumeration counted on the way (round 20), so the card can say the
   * pre-flop figure forward instead of asking to be trusted.
   *
   * The Ante and the Blind do not depend on the raise size and the Play bet
   * *is* the raise, so these rebuild every raise exactly:
   *   winUnits(bet)  = winSide + bet * wins
   *   lossUnits(bet) = (side - winSide) - bet * losses
   * and their sum over the 2,097,572,400 endings is that raise's EV.
   *
   * Optional because a table solved before they existed has none, and a card
   * that says less is better than a card that estimates.
   */
  /** Endings the player finishes ahead in and behind. Ties are the rest. */
  wins?: number;
  losses?: number;
  /** Ante and Blind units across the winning endings, and across all of them. */
  winSide?: number;
  side?: number;
  /** The check branch: flops, how many it raises on, and the value of each group. */
  flops?: number;
  flopRaises?: number;
  flopRaiseValue?: number;
  flopCheckValue?: number;

  /*
   * And the check branch's own endings (round 28), which round 20 did not take.
   * Without them checking was the one action in the block that could show no
   * percentages and no arithmetic from them.
   *
   * **They are out of \`checkOutcomes\`, not out of 2,097,572,400.** A five-card
   * board is reached by ten different flops and the check line is not the same
   * line on each — the same five cards may be raised on one flop and checked on
   * another, because the decision is made from three of them. So the check
   * branch runs to 19,600 x 1,081 x 990 = 20,975,724,000 endings. The scale is
   * stored rather than assumed, because a reader who used the raise branch's
   * figure would be out by a factor of ten and the shares would still look
   * plausible.
   */
  checkWins?: number;
  checkTies?: number;
  checkLosses?: number;
  /** What those endings pay and cost, so the shares can state their own sum. */
  checkWinUnits?: number;
  checkLossUnits?: number;
  checkOutcomes?: number;
}

/** The blind paytable these numbers were solved against. */
export const PREFLOP_TABLE_PAYTABLE = ${JSON.stringify(asset.blindPaytable)};

export const PREFLOP_TABLE: Readonly<Record<string, PreflopRow>> = {
${rows}
};

/**
 * The solved row for a class label.
 *
 * Throws rather than returning null: every two-card hand belongs to one of the
 * 169 classes by construction, so a miss means the label was built wrongly, and
 * grading a decision against a silently absent row is the one outcome worse
 * than crashing.
 */
export function preflopRow(label: string): PreflopRow {
  const row = PREFLOP_TABLE[label];
  if (!row) throw new Error(\`No solved pre-flop row for \${label}\`);
  return row;
}
`;

const target = join(PACKAGE_ROOT, 'src', 'uth', 'preflop-table.ts');
writeFileSync(target, source, 'utf8');
process.stdout.write(
  `${target}\n  ${labels.length} classes, ${(source.length / 1024).toFixed(1)} KB of source\n`,
);
