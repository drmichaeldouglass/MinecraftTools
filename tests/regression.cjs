const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness() {
  const callbacks = [];
  const intervals = new Map();
  let nextIntervalId = 0;
  const clearedIntervals = [];
  const dimensions = new Map();
  const signal = { subscribe() {} };
  const world = {
    afterEvents: { playerSpawn: signal, playerLeave: signal }, beforeEvents: {},
    getAllPlayers: () => [], getDimension: id => dimensions.get(id.replace('minecraft:', ''))
  };
  const system = {
    afterEvents: { scriptEventReceive: signal }, runTimeout: fn => callbacks.push(fn),
    run: fn => callbacks.push(fn),
    runInterval: fn => { const id = ++nextIntervalId; intervals.set(id, fn); return id; },
    clearRun(id) { clearedIntervals.push(id); intervals.delete(id); }
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
  return { ctx, player, dimension, callbacks, tick, intervals, clearedIntervals };
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


test('coordinate boxes reject malformed values instead of extracting unrelated digits', () => {
  const { ctx } = harness();
  for (const args of [
    ['1..2', '', '3'], ['10abc', '', '20'], ['10', '64 70', '20'],
    ['10', 'bad Y', '20'], ['10', '', '20abc'], ['10', '', '2..3'],
    ['1 2 3', '64', '20'], ['9'.repeat(400), '', '20']
  ]) assert.equal(ctx.coordinatesFromFormText(...args), null, args.join(' / '));
  assert.equal(ctx.parseTeleportCoordinates(`1 ${'9'.repeat(400)} 2`),null);
  assert.equal(ctx.coordinatesFromFormText(`Nearest place at 1, ${'9'.repeat(400)}, 2`, '', ''),null);
  assert.equal(ctx.coordinatesFromFormText('+10', '-40.5', '-20').y, -40.5);
  assert.equal(ctx.coordinatesFromFormText('10', ' (y?) ', '20').y, undefined);
});

function previewForms(ctx) {
  const pending = [];
  ctx.MessageFormData = class {
    title() { return this; } body() { return this; }
    button1() { return this; } button2() { return this; }
    show() { return new Promise((resolve, reject) => pending.push({ resolve, reject })); }
  };
  return pending;
}
const previewBounds = { x1:0, y1:64, z1:1, x2:2, y2:66, z2:3 };

test('a superseded preview cannot execute or clear the replacement preview', async () => {
  const { ctx, player, tick, intervals } = harness();
  const pending = previewForms(ctx);
  let oldBuilds = 0, newBuilds = 0;
  ctx.startPreview(player, previewBounds, 'particle', 'Old', () => oldBuilds++);
  await tick();
  ctx.startPreview(player, previewBounds, 'particle', 'New', () => newBuilds++);
  await tick();
  pending[0].resolve({ canceled:false, selection:0 });
  await tick();
  assert.equal(oldBuilds, 0);
  assert.equal(intervals.size, 1);
  pending[1].resolve({ canceled:false, selection:0 });
  await tick();
  assert.equal(newBuilds, 1);
  assert.equal(intervals.size, 0);
});

test('rejected preview clears its ticker, and a delayed obsolete preview never opens', async () => {
  const { ctx, player, tick, intervals } = harness();
  const pending = previewForms(ctx);
  ctx.startPreview(player, previewBounds, 'particle', 'Old', () => assert.fail('obsolete build'));
  ctx.startPreview(player, previewBounds, 'particle', 'New', () => {});
  await tick();
  assert.equal(pending.length, 1);
  const originalError = console.error;
  console.error = () => {};
  try { pending[0].reject(new Error('form unavailable')); await tick(); }
  finally { console.error = originalError; }
  assert.equal(intervals.size, 0);
});

test('preview confirmation remains usable after its drawing expires', async () => {
  const { ctx, player, tick, intervals } = harness();
  const pending = previewForms(ctx);
  let builds = 0;
  ctx.startPreview(player, previewBounds, 'particle', 'Build', () => builds++);
  await tick();
  const ticker = [...intervals.values()][0];
  for (let i = 0; i < 61; i++) ticker();
  assert.equal(intervals.size, 0);
  pending[0].resolve({ canceled:false, selection:0 });
  await tick();
  assert.equal(builds, 1);
});

function blockWorld(dimension) {
  const blocks = new Map();
  dimension.getBlock = ({x,y,z}) => {
    const typeId = blocks.get(`${x},${y},${z}`) || (y < 64 ? 'minecraft:stone' : 'minecraft:air');
    return { typeId, isAir:typeId === 'minecraft:air' };
  };
  dimension.runCommand = command => {
    const p = command.split(/\s+/);
    if (p[0] !== 'fill' && p[0] !== 'setblock') return { successCount:1 };
    const fill = p[0] === 'fill';
    const [x1,y1,z1] = p.slice(1,4).map(Number);
    const [x2,y2,z2] = fill ? p.slice(4,7).map(Number) : [x1,y1,z1];
    const typeId = p[fill ? 7 : 4];
    let changed = 0;
    for(let x=x1;x<=x2;x++) for(let y=y1;y<=y2;y++) for(let z=z1;z<=z2;z++) {
      if(dimension.getBlock({x,y,z}).typeId !== typeId) {
        blocks.set(`${x},${y},${z}`,typeId); changed++;
      }
    }
    if (!changed) throw new Error('No blocks changed');
    return { successCount:changed };
  };
}

test('all base templates and staircases finish despite already-empty air and duplicate placements', async () => {
  for (const facing of [{x:1,z:0},{x:-1,z:0},{x:0,z:1},{x:0,z:-1}]) {
    for (const key of ['simple_house','large_house','fort','tree_house','bunker','stairs_up','stairs_down']) {
      const { ctx, player, dimension } = harness();
      player.getViewDirection = () => facing;
      blockWorld(dimension);
      const plan = key.startsWith('stairs')
        ? ctx.createStairPlan(player,3,8,'minecraft:stone_bricks',key.endsWith('up')?'up':'down',true)
        : ctx.createBaseTemplatePlan(player,key);
      await ctx.executeBuildPlan(player,plan,key,'Completed');
      assert.ok(player.messages.some(m=>m.includes('Completed')), key);
      assert.ok(!player.messages.some(m=>m.includes('command failed')), key);
      await ctx.executeUndo(player);
      assert.ok(player.messages.some(m=>m.includes('Undid')), key);
    }
  }
});

test('flattening already-clear ground still places its new floor', async () => {
  const { ctx, player, dimension } = harness();
  blockWorld(dimension);
  const b = { x1:-5,y1:63,z1:-5,x2:5,y2:74,z2:5 };
  await ctx.executeLevelGround(player,b,5,'minecraft:grass_block');
  assert.equal(dimension.getBlock({x:0,y:63,z:0}).typeId,'minecraft:grass_block');
  assert.ok(player.messages.some(m=>m.includes('Land flattened')));
});

test('real block-command failures still stop a build and preserve its undo', async () => {
  const { ctx, player, dimension } = harness();
  dimension.getBlock = () => ({ typeId:'minecraft:air',isAir:true });
  const commands = [];
  dimension.runCommand = c => {
    commands.push(c);
    if(c.startsWith('fill')) throw new Error('invalid block');
    return { successCount:1 };
  };
  const plan = { name:'test',dimensionId:dimension.id,bounds:previewBounds,
    commands:['fill 0 64 1 2 66 3 minecraft:missing','setblock 0 64 1 minecraft:stone'] };
  await ctx.executeBuildPlan(player,plan,'test','Completed');
  assert.ok(player.messages.some(m=>m.includes('command failed')));
  assert.ok(!commands.some(c=>c.startsWith('setblock')));
  await ctx.executeUndo(player);
  assert.ok(commands.some(c=>c.startsWith('structure load')));
  dimension.getBlock = () => { throw new Error('unloaded'); };
  await assert.rejects(ctx.runBlockCommand(dimension,'fill 0 64 1 2 66 3 minecraft:air'),/invalid block/);
});


test('dimension changes and disconnects invalidate a pending preview confirmation', async () => {
  for (const disconnect of [false, true]) {
    const { ctx, player, tick, intervals } = harness();
    const pending = previewForms(ctx);
    ctx.startPreview(player, previewBounds, 'particle', 'Build', () => assert.fail('stale build'));
    await tick();
    if (disconnect) player.isValid = false;
    else player.dimension = { id:'minecraft:nether' };
    pending[0].resolve({ canceled:false, selection:0 });
    await tick();
    assert.equal(intervals.size, 0);
  }
});

test('no-op checks respect hollow interiors, outline shells and unavailable blocks', () => {
  const { ctx, dimension } = harness();
  dimension.getBlock = ({x,y,z}) => ({typeId: x===1 && y===65 && z===1 ? 'minecraft:dirt' : 'minecraft:stone'});
  assert.equal(ctx.blockCommandIsSatisfied(dimension,'fill 0 64 0 2 66 2 minecraft:stone outline'),true);
  assert.equal(ctx.blockCommandIsSatisfied(dimension,'fill 0 64 0 2 66 2 minecraft:stone hollow'),false);
  dimension.getBlock = ({x,y,z}) => ({typeId: x===1 && y===65 && z===1 ? 'minecraft:air' : 'minecraft:stone'});
  assert.equal(ctx.blockCommandIsSatisfied(dimension,'fill 0 64 0 2 66 2 minecraft:stone hollow'),true);
  dimension.getBlock = () => undefined;
  assert.equal(ctx.blockCommandIsSatisfied(dimension,'fill 0 64 0 2 66 2 minecraft:air'),false);
  assert.equal(ctx.blockCommandIsSatisfied(dimension,'fill 2 66 2 0 64 0 minecraft:air'),false);
});
