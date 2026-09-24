const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness() {
  const callbacks = [];
  const dimensions = new Map();
  const signal = { subscribe() {} };
  const world = {
    afterEvents: { playerSpawn: signal, playerLeave: signal }, beforeEvents: {},
    getAllPlayers: () => [], getDimension: id => dimensions.get(id.replace('minecraft:', ''))
  };
  const system = {
    afterEvents: { scriptEventReceive: signal }, runTimeout: fn => callbacks.push(fn),
    run: fn => callbacks.push(fn), runInterval: () => 1, clearRun() {}
  };
  const ctx = vm.createContext({ world, system, console, ItemStack: class {} });
  const source = fs.readFileSync(process.env.TOOLS_SOURCE || path.join(__dirname, '../Behavior_Pack/scripts/main.js'), 'utf8');
  vm.runInContext(source.replace(/^import .*;\n/gm, ''), ctx);
  const dimension = {
    id: 'minecraft:overworld', runCommand: () => ({ successCount: 1 }),
    getTopmostBlock: () => undefined
  };
  dimensions.set('overworld', dimension);
  const player = {
    id: 'player1', dimension, location: { x: 0, y: 64, z: 0 }, isValid: () => true,
    getViewDirection: () => ({ x: 0, y: 0, z: 1 }), messages: [], teleports: [],
    sendMessage(m) { this.messages.push(m); }, playSound() {}, addEffect() {},
    teleport(loc, options) { this.teleports.push({ loc, options }); }
  };
  async function tick() {
    await new Promise(resolve => setImmediate(resolve));
    for (const fn of callbacks.splice(0)) fn();
    await new Promise(resolve => setImmediate(resolve));
  }
  return { ctx, player, dimension, callbacks, tick };
}

test('dig depth starts below the feet for all facings', () => {
  const { ctx, player } = harness();
  for (const dir of [{x:1,z:0},{x:-1,z:0},{x:0,z:1},{x:0,z:-1}]) {
    player.getViewDirection = () => dir;
    for (const depth of [1, 3, 25]) {
      const b = ctx.calculateBounds(player, 3, 5, depth, 'down');
      assert.equal(b.y2, 63); assert.equal(b.y1, 64 - depth);
      assert.equal((b.x2-b.x1+1)*(b.z2-b.z1+1), 15);
    }
  }
});

test('locate replies ignore trailing distance and preserve unknown Y', () => {
  const { ctx } = harness();
  const parsed = ctx.parseTeleportCoordinates('The nearest village is at block 1256, (y?), -648 (1432 blocks away)');
  assert.equal(parsed.x, 1256); assert.equal(parsed.z, -648); assert.equal(parsed.y, undefined);
  const xyz = ctx.parseTeleportCoordinates('The nearest city is at [1256, -51, -648] (1432 blocks away)');
  assert.equal(xyz.y, -51); assert.equal(xyz.z, -648);
});

test('coordinate command supports two or three numbers and rejects extra ones', () => {
  const { ctx } = harness();
  assert.equal(ctx.parseTeleportCoordinates('-20 30').z, 30);
  assert.equal(ctx.parseTeleportCoordinates('-20 64 30').y, 64);
  assert.equal(ctx.parseTeleportCoordinates('1 2 3 4'), null);
  assert.equal(ctx.parseTeleportCoordinates('1,2,3,4'), null);
  assert.equal(ctx.parseTeleportCoordinates('1..2 3'), null);
  assert.equal(ctx.parseTeleportCoordinates('nonsense'), null);
});

test('failed ticking area creation never teleports to an unchecked location', async () => {
  const { ctx, player, dimension, tick } = harness();
  dimension.runCommand = () => { throw new Error('ticking area limit'); };
  await ctx.teleportToCoordinates(player, {x:1000,z:2000});
  await tick();
  assert.equal(player.teleports.length, 0);
});

test('void destination retries, removes ticking area, and keeps player in place', async () => {
  const { ctx, player, dimension, tick } = harness();
  const commands = [];
  dimension.runCommand = cmd => { commands.push(cmd); };
  const trip = ctx.teleportToCoordinates(player, {x:1000,z:2000});
  for (let i = 0; i < 6; i++) await tick();
  await trip;
  assert.equal(player.teleports.length, 0);
  assert.equal(commands.filter(c => c.startsWith('tickingarea remove')).length, 1);
});

test('dimension change while loading cancels travel and cleans the ticking area', async () => {
  const { ctx, player, dimension, tick } = harness();
  const commands = [];
  dimension.runCommand = c => commands.push(c);
  const trip = ctx.teleportToCoordinates(player, {x:1000,z:2000});
  await new Promise(resolve => setImmediate(resolve));
  player.dimension = { id: 'minecraft:nether' };
  await tick(); await trip;
  assert.equal(player.teleports.length, 0);
  assert.ok(commands.some(c => c.startsWith('tickingarea remove')));
});

test('simultaneous trips cannot share or delete each other\'s loading area', async () => {
  const { ctx, player, dimension, tick } = harness();
  const commands = [];
  dimension.runCommand = c => commands.push(c);
  const first = ctx.teleportToCoordinates(player, {x:1000,z:2000});
  await ctx.teleportToCoordinates(player, {x:3000,z:4000});
  for (let i = 0; i < 6; i++) await tick();
  await first;
  assert.equal(commands.filter(c => c.startsWith('tickingarea add')).length, 1);
});

function solidColumn(dimension) {
  dimension.getTopmostBlock = () => ({location:{y:63}});
  dimension.getBlock = ({y}) => ({ isAir:y >= 64, typeId:y >=64 ? 'minecraft:air' : 'minecraft:stone' });
}

test('loaded safe ground lands once without creating a ticking area', async () => {
  const { ctx, player, dimension } = harness();
  solidColumn(dimension);
  dimension.runCommand = () => { throw new Error('should not need commands'); };
  await ctx.teleportToCoordinates(player, {x:1000,z:2000});
  assert.equal(player.teleports.length, 1);
  assert.equal(player.teleports[0].loc.y, 64);
});

test('loaded columns work without optional getTopmostBlock API', () => {
  const { ctx, dimension } = harness();
  solidColumn(dimension); delete dimension.getTopmostBlock;
  assert.equal(ctx.findStandableColumn(dimension, 0, 0, null).y, 64);
});

test('build and undo cannot overlap an unfinished build', async () => {
  const { ctx, player, dimension } = harness();
  const commands = [];
  dimension.runCommand = cmd => { commands.push(cmd); return {successCount:1}; };
  const b = {x1:0,y1:63,z1:1,x2:2,y2:63,z2:3};
  const first = ctx.executePlatform(player,b,3,'minecraft:glass');
  await ctx.executePlatform(player,b,3,'minecraft:stone');
  await ctx.executeUndo(player);
  await first;
  assert.equal(commands.filter(c=>c.startsWith('fill')).length,1);
  assert.ok(commands.every(c=>!c.startsWith('structure load')));
  await ctx.executeUndo(player);
  assert.equal(commands.filter(c=>c.startsWith('structure load')).length,1);
});

test('failed snapshot releases build lock and does not modify blocks', async () => {
  const { ctx, player, dimension } = harness();
  let attempts=0;
  dimension.runCommand = cmd => {
    assert.ok(cmd.startsWith('structure save')); attempts++; throw new Error('unloaded');
  };
  const b={x1:0,y1:63,z1:1,x2:2,y2:63,z2:3};
  await ctx.executePlatform(player,b,3,'minecraft:glass');
  await ctx.executePlatform(player,b,3,'minecraft:glass');
  assert.equal(attempts,2);
});

test('helper device has an always-usable trigger and remains a device after use', () => {
  const item = JSON.parse(fs.readFileSync(path.join(__dirname,'../Behavior_Pack/items/helper_device.json')));
  const food = item['minecraft:item'].components['minecraft:food'];
  assert.equal(food.can_always_eat,true);
  assert.equal(food.using_converts_to,'tools:helper_device');
});

test('script event parses actual locate text before teleporting', () => {
  const { ctx, player } = harness();
  let destination;
  ctx.teleportToCoordinates = (p, coords) => { destination = coords; };
  ctx.handleTeleportScriptEvent(player, 'The nearest village is at block 1256, (y?), -648 (1432 blocks away)');
  assert.equal(destination.x, 1256);
  assert.equal(destination.z, -648);
  assert.equal(destination.y, undefined);
});

test('teleport form reads X, optional Y and Z boxes', () => {
  const { ctx } = harness();
  const xz = ctx.coordinatesFromFormText('1256', '', '-648');
  assert.equal(xz.x, 1256); assert.equal(xz.z, -648); assert.equal(xz.y, undefined);
  assert.equal(ctx.coordinatesFromFormText('10', '(y?)', '20').y, undefined);
  assert.equal(ctx.coordinatesFromFormText('10', '-40', '20').y, -40);
  assert.equal(ctx.coordinatesFromFormText('The nearest village is at block 5, (y?), 6', '', '').z, 6);
  assert.equal(ctx.coordinatesFromFormText('10', '', ''), null);
});

test('biome finder shows coordinates without teleporting', () => {
  const { ctx, player, dimension } = harness();
  const searches = [];
  const properties = {};
  dimension.calculateClosestBiomeFromSeed = (pos, id) => { searches.push(id); return { x: 300.7, y: 64, z: -400.2 }; };
  player.setDynamicProperty = (k, v) => { properties[k] = v; };
  let body;
  ctx.ActionFormData = class {
    title() { return this; } button() { return this; }
    body(text) { body = text; return this; }
    show() { return new Promise(() => {}); }
  };
  ctx.showNearestBiome(player, { name: 'Plains', id: 'minecraft:plains' });
  assert.deepEqual(searches, ['minecraft:plains']);
  assert.match(body, /X 300 +Z -401/);
  assert.ok(player.messages.some(m => m.includes('X 300, Z -401') && m.includes('501 blocks')));
  assert.equal(properties.last_found_location, 'Plains: X 300, Z -401');
  assert.equal(player.teleports.length, 0);
});

test('biome finder reports when nothing is found', () => {
  const { ctx, player, dimension } = harness();
  dimension.calculateClosestBiomeFromSeed = () => undefined;
  ctx.showNearestBiome(player, { name: 'Plains', id: 'minecraft:plains' });
  assert.ok(player.messages.some(m => m.includes('No Plains')));
  assert.equal(player.teleports.length, 0);
});
