// Writes the preset monster spawner structures the Spawner XP Farm loads into
// its sealed dark room. Bedrock structures are little-endian NBT. Run with
// `node tools/make_spawner_structures.cjs` after changing SPAWNER_MOBS.
const fs = require('node:fs');
const path = require('node:path');

const SPAWNER_MOBS = [
  { name: 'zombie_spawner', entity: 'minecraft:zombie', width: 0.6, height: 1.9 },
  { name: 'skeleton_spawner', entity: 'minecraft:skeleton', width: 0.6, height: 1.99 }
];

// Block palette version 1.21.40; newer games upgrade it on load.
const BLOCK_VERSION = (1 << 24) | (21 << 16) | (40 << 8);

const TAG = { byte: 1, short: 2, int: 3, float: 5, string: 8, list: 9, compound: 10 };

function writer() {
  const chunks = [];
  const push = (size, fill) => { const b = Buffer.alloc(size); fill(b); chunks.push(b); };
  return {
    byte: v => push(1, b => b.writeInt8(v)),
    short: v => push(2, b => b.writeInt16LE(v)),
    int: v => push(4, b => b.writeInt32LE(v)),
    float: v => push(4, b => b.writeFloatLE(v)),
    string: v => { const s = Buffer.from(v, 'utf8'); push(2, b => b.writeUInt16LE(s.length)); chunks.push(s); },
    done: () => Buffer.concat(chunks)
  };
}

// Values are [type, payload]; lists are ['list', itemType, items].
function writePayload(w, [type, value, items]) {
  if (type === 'compound') {
    for (const [key, child] of Object.entries(value)) {
      w.byte(TAG[child[0]]);
      w.string(key);
      writePayload(w, child);
    }
    w.byte(0);
  } else if (type === 'list') {
    w.byte(TAG[value]);
    w.int(items.length);
    for (const item of items) writePayload(w, [value, ...(Array.isArray(item) ? item : [item])]);
  } else {
    w[type](value);
  }
}

function spawnerStructure(mob) {
  const ints = values => ['list', 'int', values];
  const root = ['compound', {
    format_version: ['int', 1],
    size: ints([1, 1, 1]),
    structure: ['compound', {
      block_indices: ['list', 'list', [['int', [0]], ['int', [-1]]]],
      entities: ['list', 'compound', []],
      palette: ['compound', {
        default: ['compound', {
          block_palette: ['list', 'compound', [{
            name: ['string', 'minecraft:mob_spawner'],
            states: ['compound', {}],
            version: ['int', BLOCK_VERSION]
          }]],
          block_position_data: ['compound', {
            0: ['compound', {
              block_entity_data: ['compound', {
                id: ['string', 'MobSpawner'],
                isMovable: ['byte', 1],
                x: ['int', 0], y: ['int', 0], z: ['int', 0],
                EntityIdentifier: ['string', mob.entity],
                Delay: ['short', 20],
                MinSpawnDelay: ['short', 200],
                MaxSpawnDelay: ['short', 800],
                SpawnCount: ['short', 4],
                MaxNearbyEntities: ['short', 6],
                RequiredPlayerRange: ['short', 16],
                SpawnRange: ['short', 4],
                DisplayEntityWidth: ['float', mob.width],
                DisplayEntityHeight: ['float', mob.height],
                DisplayEntityScale: ['float', 1]
              }]
            }]
          }]
        }]
      }]
    }],
    structure_world_origin: ints([0, 0, 0])
  }];
  const w = writer();
  w.byte(TAG.compound);
  w.string('');
  writePayload(w, root);
  return w.done();
}

const STRUCTURE_DIR = path.join(__dirname, '../Behavior_Pack/structures/helpertools');

if (require.main === module) {
  fs.mkdirSync(STRUCTURE_DIR, { recursive: true });
  for (const mob of SPAWNER_MOBS) {
    const file = path.join(STRUCTURE_DIR, `${mob.name}.mcstructure`);
    fs.writeFileSync(file, spawnerStructure(mob));
    console.log(`Wrote ${path.relative(process.cwd(), file)}`);
  }
}

module.exports = { SPAWNER_MOBS, STRUCTURE_DIR, spawnerStructure };
