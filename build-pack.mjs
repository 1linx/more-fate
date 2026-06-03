/**
 * Compiles src/skills/*.json into packs/skills (LevelDB).
 * Run with: node build-pack.mjs
 * Foundry must be closed when running this, then copy the module across.
 */

import { ClassicLevel } from './node_modules/classic-level/index.js';
import { readFileSync, readdirSync } from 'fs';

const SRC  = './src/skills';
const DEST = './packs/skills';

const db = new ClassicLevel(DEST, { valueEncoding: 'json' });
await db.open();

// Clear all existing entries
for await (const key of db.keys()) await db.del(key);

const files = readdirSync(SRC).filter(f => f.endsWith('.json'));
for (const file of files) {
  const doc = JSON.parse(readFileSync(`${SRC}/${file}`, 'utf8'));
  await db.put(`!items!${doc._id}`, doc);
  console.log(`Packed: ${doc.name}`);
}

await db.close();
console.log(`\nDone — ${files.length} skills written to ${DEST}`);
