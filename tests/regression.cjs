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
    teleport(loc, options) { this.teleports.push({ loc, options }); },
    runCommand(command) { this.commands.push(command); return { successCount: 1 }; }, commands: []
  };
  async function tick() {
    await new Promise(resolve => setImmediate(resolve));
    for (const fn of callbacks.splice(0)) fn();
    await new Promise(resolve => setImmediate(resolve));
  }
  const evaluate = expression => vm.runInContext(expression, ctx);
  return { ctx, player, dimension, callbacks, tick, intervals, clearedIntervals, evaluate };
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

test('biome finder searches the whole dimension height and offers a direct teleport', async () => {
  const { ctx, player, dimension, tick } = harness();
  const searches = [];
  const properties = {};
  dimension.calculateClosestBiomeFromSeed = (pos, id, options) => { searches.push({ pos, id, options }); return { x: 300.7, y: 64, z: -400.2 }; };
  player.setDynamicProperty = (k, v) => { properties[k] = v; };
  let body, buttons = [];
  ctx.ActionFormData = class {
    title() { return this; } button(label) { buttons.push(label); return this; }
    body(text) { body = text; return this; }
    show() { return new Promise(() => {}); }
  };
  ctx.showNearestBiome(player, { name: 'Plains', id: 'minecraft:plains' });
  await tick();
  assert.equal(searches.length, 1);
  assert.equal(searches[0].id, 'minecraft:plains');
  assert.equal(searches[0].options.boundingSize.x, 1024);
  assert.ok(searches[0].options.boundingSize.y >= 384, 'vertical search covers the overworld height');
  assert.equal(searches[0].pos.y, (319 - 64) / 2);
  assert.match(body, /X 300 +Z -401/);
  assert.ok(buttons[0].includes('Teleport There Now'));
  assert.ok(player.messages.some(m => m.includes('X 300, Z -401') && m.includes('501 blocks')));
  assert.equal(properties.last_found_location, 'Plains: X 300, Z -401');
  assert.equal(player.teleports.length, 0);
});

test('biome result window teleports straight to the found coordinates', async () => {
  const { ctx, player, dimension, tick } = harness();
  dimension.calculateClosestBiomeFromSeed = () => ({ x: 300.7, y: -20, z: -400.2 });
  player.setDynamicProperty = () => {};
  let destination;
  ctx.teleportToCoordinates = (p, coords) => { destination = coords; };
  ctx.ActionFormData = class {
    title() { return this; } button() { return this; } body() { return this; }
    show() { return Promise.resolve({ canceled: false, selection: 0 }); }
  };
  ctx.showNearestBiome(player, { name: 'Plains', id: 'minecraft:plains' });
  await tick();
  assert.equal(JSON.stringify(destination), JSON.stringify({ x: 300, z: -401 }));
  ctx.showNearestBiome(player, { name: 'Lush Caves', id: 'minecraft:lush_caves', underground: true });
  await tick();
  assert.equal(JSON.stringify(destination), JSON.stringify({ x: 300, z: -401, y: -20 }));
});

test('biome finder widens the search before giving up', async () => {
  const { ctx, player, dimension, tick } = harness();
  const sizes = [];
  dimension.calculateClosestBiomeFromSeed = (pos, id, options) => { sizes.push(options.boundingSize.x); return undefined; };
  ctx.showNearestBiome(player, { name: 'Plains', id: 'minecraft:plains' });
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(sizes, [1024, 4096, 8192]);
  assert.ok(player.messages.some(m => m.includes('No Plains') && m.includes('8192')));
  assert.equal(player.teleports.length, 0);
});

test('biome finder reports API errors instead of failing silently', async () => {
  const { ctx, player, dimension, tick } = harness();
  dimension.calculateClosestBiomeFromSeed = () => { throw new Error('boom'); };
  ctx.showNearestBiome(player, { name: 'Plains', id: 'minecraft:plains' });
  await tick();
  assert.ok(player.messages.some(m => m.includes('Could not search for Plains') && m.includes('boom')));
});

test('structure finder gives the locate command and runs it as the player', async () => {
  const { ctx, player, tick } = harness();
  const properties = {};
  player.setDynamicProperty = (k, v) => { properties[k] = v; };
  ctx.showStructureLocateCommand(player, { name: 'Village', id: 'minecraft:village' });
  await tick();
  assert.deepEqual(player.commands, ['locate structure minecraft:village']);
  assert.ok(player.messages.some(m => m.includes('/locate structure minecraft:village')));
  assert.ok(player.messages.some(m => m.includes('Cheats')));
  assert.ok(properties.last_found_location.startsWith('Village:'));
  assert.equal(player.teleports.length, 0);
  player.runCommand = () => { throw new Error('No structure found'); };
  ctx.showStructureLocateCommand(player, { name: 'Village', id: 'minecraft:village' });
  await tick();
  assert.ok(player.messages.some(m => m.includes('could not find a Village') && m.includes('No structure found')));
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
  const states = new Map();
  dimension.getBlock = ({x,y,z}) => {
    const key = `${x},${y},${z}`;
    const typeId = blocks.get(key) || (y < 64 ? 'minecraft:stone' : 'minecraft:air');
    const blockStates = states.get(key) || {};
    return { typeId, isAir:typeId === 'minecraft:air', permutation:{ getState: name => blockStates[name] } };
  };
  dimension.runCommand = command => {
    const p = command.split(/\s+/);
    if (p[0] !== 'fill' && p[0] !== 'setblock') return { successCount:1 };
    const fill = p[0] === 'fill';
    const [x1,y1,z1] = p.slice(1,4).map(Number);
    const [x2,y2,z2] = fill ? p.slice(4,7).map(Number) : [x1,y1,z1];
    let index = fill ? 7 : 4;
    const typeId = p[index++];
    let blockStates = {};
    if (p[index] && p[index].startsWith('[')) blockStates = JSON.parse('{' + p[index++].slice(1,-1).replace(/=/g, ':') + '}');
    const mode = p[index] || 'replace';
    let changed = 0;
    for(let x=x1;x<=x2;x++) for(let y=y1;y<=y2;y++) for(let z=z1;z<=z2;z++) {
      const key = `${x},${y},${z}`;
      const current = dimension.getBlock({x,y,z});
      if (mode === 'keep' && !current.isAir) continue;
      const sameStates = JSON.stringify(states.get(key) || {}) === JSON.stringify(blockStates);
      if(current.typeId !== typeId || !sameStates) {
        blocks.set(key,typeId); states.set(key, blockStates); changed++;
      }
    }
    if (!changed) throw new Error('No blocks changed');
    return { successCount:changed };
  };
  return { blocks, states };
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

async function settle(promise, tick) {
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < 1000 && !done; i++) await tick();
  return promise;
}

test('block commands with states and keep mode are parsed and verified', () => {
  const { ctx, dimension } = harness();
  const parsed = ctx.parseBlockCommand('setblock 1 64 2 minecraft:bed ["direction"=2,"head_piece_bit"=true]');
  assert.equal(parsed.blockId, 'minecraft:bed');
  assert.equal(JSON.stringify(parsed.states), JSON.stringify({ direction:'2', head_piece_bit:'true' }));
  assert.equal(parsed.mode, 'replace');
  assert.equal(ctx.parseBlockCommand('fill 0 64 0 2 64 2 minecraft:dirt keep').mode, 'keep');
  assert.equal(ctx.parseBlockCommand('fill 0 64 0 2 64 2 minecraft:dirt ["bad state"] keep'), null);
  assert.equal(ctx.parseBlockCommand('setblock 1 64 2 minecraft:bed ["direction"=2] replace extra'), null);
  blockWorld(dimension);
  dimension.runCommand('setblock 1 64 2 minecraft:bed ["direction"=2,"head_piece_bit"=true]');
  assert.equal(ctx.blockCommandIsSatisfied(dimension,'setblock 1 64 2 minecraft:bed ["direction"=2,"head_piece_bit"=true]'), true);
  assert.equal(ctx.blockCommandIsSatisfied(dimension,'setblock 1 64 2 minecraft:bed ["direction"=0,"head_piece_bit"=true]'), false);
  assert.equal(ctx.blockCommandIsSatisfied(dimension,'fill 0 60 0 2 63 2 minecraft:dirt keep'), true);
  assert.equal(ctx.blockCommandIsSatisfied(dimension,'fill 0 60 0 2 64 2 minecraft:dirt keep'), false);
  assert.equal(ctx.blockCommandIsSatisfied(dimension,'fill 0 63 0 2 63 2 minecraft:stone'), true);
});

test('village fits a single undo snapshot and every command stays inside its bounds and the fill limit', () => {
  const { ctx, player, evaluate } = harness();
  const size = evaluate('VILLAGE_SIZE');
  const paletteCount = evaluate('VILLAGE_PALETTES.length');
  assert.ok(size <= 64, 'structure save allows at most 64 blocks a side');
  for (const facing of [{x:1,z:0},{x:-1,z:0},{x:0,z:1},{x:0,z:-1}]) {
    player.getViewDirection = () => facing;
    for (let palette = 0; palette < paletteCount; palette++) {
      const plan = ctx.createVillagePlan(player, palette, true);
      const b = plan.bounds;
      assert.ok(b.x2 - b.x1 + 1 <= 64 && b.z2 - b.z1 + 1 <= 64 && b.y2 - b.y1 + 1 <= 384);
      assert.ok(plan.commands.length > 500, 'village has many commands');
      for (const command of plan.commands) {
        const c = ctx.parseBlockCommand(command);
        assert.ok(c, `unparseable command: ${command}`);
        assert.ok(c.x1 >= b.x1 && c.x2 <= b.x2 && c.y1 >= b.y1 && c.y2 <= b.y2 && c.z1 >= b.z1 && c.z2 <= b.z2, `outside bounds: ${command}`);
        assert.ok((c.x2-c.x1+1)*(c.y2-c.y1+1)*(c.z2-c.z1+1) <= 32768, `too large: ${command}`);
      }
    }
  }
  const footprint = ctx.createVillagePlan(player, 0, true).bounds;
  assert.equal(footprint.x2 - footprint.x1 + 1, size);
  assert.equal(footprint.z2 - footprint.z1 + 1, size);
});

test('village builds and undoes in all four facings, spreading commands over several ticks', async () => {
  for (const facing of [{x:1,z:0},{x:-1,z:0},{x:0,z:1},{x:0,z:-1}]) {
    const { ctx, player, dimension, tick, callbacks, evaluate } = harness();
    player.getViewDirection = () => facing;
    const { blocks } = blockWorld(dimension);
    const batchSize = evaluate('VILLAGE_BATCH_SIZE');
    const plan = ctx.createVillagePlan(player, 0, true);
    let yields = 0;
    const originalRun = ctx.system.run;
    ctx.system.run = fn => { yields++; callbacks.push(fn); };
    await settle(ctx.executeBuildPlan(player, plan, 'village', 'Village done'), tick);
    ctx.system.run = originalRun;
    assert.ok(player.messages.some(m => m.includes('Village done')), player.messages.join('\n'));
    assert.ok(!player.messages.some(m => m.includes('command failed')));
    assert.ok(yields >= Math.floor(plan.commands.length / batchSize) - 1, 'build yields between batches');
    const placed = new Set(blocks.values());
    for (const needed of ['minecraft:bed', 'minecraft:dark_oak_door', 'minecraft:wheat', 'minecraft:water', 'minecraft:sea_lantern', 'minecraft:gray_concrete', 'minecraft:bell']) {
      assert.ok(placed.has(needed), `${needed} placed`);
    }
    const first = ctx.parseBlockCommand(plan.commands[0]);
    assert.equal(first.blockId, 'minecraft:air');
    await ctx.executeUndo(player);
    assert.ok(player.messages.some(m => m.includes('Undid')));
  }
});

test('village without ground preparation leaves the terrain alone and still undoes', async () => {
  const { ctx, player, dimension, tick, evaluate } = harness();
  blockWorld(dimension);
  const size = evaluate('VILLAGE_SIZE');
  const prepared = ctx.createVillagePlan(player, 1, true);
  const coversVillage = c => { const b = ctx.parseBlockCommand(c); return b.x2 - b.x1 + 1 === size && b.z2 - b.z1 + 1 === size; };
  assert.ok(prepared.commands.some(c => c.endsWith(' keep')));
  assert.ok(prepared.commands.some(c => c.endsWith('minecraft:air') && coversVillage(c)));
  const plan = ctx.createVillagePlan(player, 1, false);
  assert.ok(!plan.commands.some(c => c.endsWith(' keep')));
  assert.ok(!plan.commands.some(coversVillage));
  await settle(ctx.executeBuildPlan(player, plan, 'village', 'Village done'), tick);
  assert.ok(player.messages.some(m => m.includes('Village done')));
  await ctx.executeUndo(player);
  assert.ok(player.messages.some(m => m.includes('Undid')));
});

test('a village can be rebuilt on top of itself without stopping on already-placed blocks', async () => {
  const { ctx, player, dimension, tick } = harness();
  blockWorld(dimension);
  for (let i = 0; i < 2; i++) {
    player.messages.length = 0;
    await settle(ctx.executeBuildPlan(player, ctx.createVillagePlan(player, 2, true), 'village', 'Village done'), tick);
    assert.ok(player.messages.some(m => m.includes('Village done')), `build ${i}: ` + player.messages.join('\n'));
  }
});

const FACINGS = [{x:1,z:0},{x:-1,z:0},{x:0,z:1},{x:0,z:-1}];
const NEIGHBOURS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

function rasterize(ctx, commands) {
  const blocks = new Set();
  for (const command of commands) {
    const p = ctx.parseBlockCommand(command);
    assert.ok(p, `unparseable command: ${command}`);
    for (let x = p.x1; x <= p.x2; x++) for (let y = p.y1; y <= p.y2; y++) for (let z = p.z1; z <= p.z2; z++) blocks.add(`${x},${y},${z}`);
  }
  return blocks;
}

function assertCommandsInside(ctx, plan, limit) {
  const b = plan.bounds;
  for (const command of plan.commands) {
    const c = ctx.parseBlockCommand(command);
    assert.ok(c, `unparseable command: ${command}`);
    assert.ok(c.x1 >= b.x1 && c.x2 <= b.x2 && c.y1 >= b.y1 && c.y2 <= b.y2 && c.z1 >= b.z1 && c.z2 <= b.z2, `outside bounds: ${command}`);
    assert.ok((c.x2-c.x1+1)*(c.y2-c.y1+1)*(c.z2-c.z1+1) <= limit, `too large: ${command}`);
  }
}

function modalForm(ctx, titles, formValues) {
  ctx.ModalFormData = class {
    title(t) { titles.push(t); return this; } dropdown() { return this; } textField() { return this; }
    slider() { return this; } toggle() { return this; }
    show() { return Promise.resolve(formValues ? { canceled:false, formValues } : { canceled:true }); }
  };
}

test('fill blocks can build upwards from the feet or downwards into the ground', async () => {
  for (const [directionIndex, y1, y2] of [[0, 64, 65], [1, 62, 63]]) {
    const { ctx, player, dimension, tick } = harness();
    blockWorld(dimension);
    const commands = [];
    const original = dimension.runCommand;
    dimension.runCommand = c => { commands.push(c); return original(c); };
    modalForm(ctx, [], [0, '', 3, 2, 4, directionIndex, 0, false]);
    ctx.openFillBlocksMenu(player);
    for (let i = 0; i < 5; i++) await tick();
    const fill = ctx.parseBlockCommand(commands.find(c => c.startsWith('fill')));
    assert.equal(fill.y1, y1);
    assert.equal(fill.y2, y2);
    assert.equal(fill.blockId, 'minecraft:oak_planks');
    assert.ok(player.messages.some(m => m.includes('Blocks placed')));
  }
  const { ctx } = harness();
  assert.equal(ctx.resolveBlockChoice(0, ' Quartz_Block '), 'minecraft:quartz_block');
  assert.equal(ctx.resolveBlockChoice(2, ''), 'minecraft:stone');
  assert.equal(ctx.resolveBlockChoice(0, 'not a block!'), null);
});

test('filtered replace fills are parsed and verified by what remains', () => {
  const { ctx, dimension } = harness();
  const parsed = ctx.parseBlockCommand('fill 0 60 0 2 62 2 minecraft:air replace minecraft:water');
  assert.equal(parsed.filterId, 'minecraft:water');
  assert.equal(parsed.mode, 'replace');
  assert.equal(ctx.parseBlockCommand('fill 0 60 0 2 62 2 minecraft:air replace minecraft:bed ["direction"=2]').filterStates.direction, '2');
  assert.equal(ctx.parseBlockCommand('setblock 0 60 0 minecraft:air replace minecraft:water'), null);
  assert.equal(ctx.parseBlockCommand('fill 0 60 0 2 62 2 minecraft:air keep minecraft:water'), null);
  assert.equal(ctx.parseBlockCommand('fill 0 60 0 2 62 2 minecraft:air replace water'), null);
  dimension.getBlock = ({x,y,z}) => ({ typeId: x===1 && y===61 && z===1 ? 'minecraft:water' : 'minecraft:stone' });
  assert.equal(ctx.blockCommandIsSatisfied(dimension, 'fill 0 60 0 2 62 2 minecraft:air replace minecraft:water'), false);
  assert.equal(ctx.blockCommandIsSatisfied(dimension, 'fill 0 60 0 2 62 2 minecraft:air replace minecraft:lava'), true);
});

test('drain plan covers every liquid around the player, survives empty boxes and undoes', async () => {
  const { ctx, player, dimension, tick, evaluate } = harness();
  const limit = evaluate('FILL_COMMAND_LIMIT');
  const plan = ctx.createDrainPlan(player, 25, 2);
  assert.equal(JSON.stringify(plan.bounds), JSON.stringify({ x1:-25, x2:25, y1:39, y2:89, z1:-25, z2:25 }));
  assertCommandsInside(ctx, plan, limit);
  const covered = new Map();
  for (const command of plan.commands) {
    const c = ctx.parseBlockCommand(command);
    assert.equal(c.blockId, 'minecraft:air');
    assert.ok(c.filterId);
    assert.equal(c.x1, -25); assert.equal(c.x2, 25); assert.equal(c.z1, -25); assert.equal(c.z2, 25);
    const rows = covered.get(c.filterId) || new Set();
    for (let y = c.y1; y <= c.y2; y++) rows.add(y);
    covered.set(c.filterId, rows);
  }
  assert.equal([...covered.keys()].sort().join(' '), 'minecraft:bubble_column minecraft:flowing_lava minecraft:flowing_water minecraft:lava minecraft:water');
  for (const rows of covered.values()) assert.equal(rows.size, 51);
  const commands = [];
  dimension.runCommand = c => {
    commands.push(c);
    if (c.startsWith('fill') && !c.endsWith('minecraft:water')) throw new Error('No blocks filled');
    return { successCount:1 };
  };
  await settle(ctx.executeBuildPlan(player, plan, 'drain', 'Drained'), tick);
  assert.ok(player.messages.some(m => m.includes('Drained')), player.messages.join('\n'));
  assert.equal(commands.filter(c => c.startsWith('fill')).length, plan.commands.length);
  await ctx.executeUndo(player);
  assert.ok(commands.some(c => c.startsWith('structure load')));
  assert.ok(ctx.createDrainPlan(player, 5, 0).commands.every(c => /water|bubble_column/.test(c)));
  assert.ok(ctx.createDrainPlan(player, 5, 1).commands.every(c => c.includes('lava')));
  player.location = { x: 0, y: -60, z: 0 };
  assert.equal(ctx.createDrainPlan(player, 10, 2).bounds.y1, -64);
});

test('shapes sit in front of the player and hollow shells have no holes', () => {
  const { ctx, player, evaluate } = harness();
  const limit = evaluate('FILL_COMMAND_LIMIT');
  const cases = [['sphere',{radius:6}],['dome',{radius:6}],['pyramid',{base:13}],['cylinder',{radius:5,height:7}],['cone',{radius:6,height:9}]];
  for (const facing of FACINGS) {
    player.getViewDirection = () => facing;
    for (const [key, params] of cases) {
      const solid = ctx.createShapePlan(player, key, params, 'minecraft:glass', false);
      const hollow = ctx.createShapePlan(player, key, params, 'minecraft:glass', true);
      assertCommandsInside(ctx, solid, limit);
      assertCommandsInside(ctx, hollow, limit);
      const S = rasterize(ctx, solid.commands), H = rasterize(ctx, hollow.commands);
      assert.ok(H.size > 0 && H.size < S.size, key);
      for (const k of H) assert.ok(S.has(k), `${key}: hollow block outside solid`);
      const b = solid.bounds;
      const openBottom = key !== 'sphere', openTop = key === 'cylinder';
      for (const k of S) {
        if (H.has(k)) continue;
        const [x, y, z] = k.split(',').map(Number);
        for (const [dx, dy, dz] of NEIGHBOURS) {
          const ny = y + dy;
          if (dy < 0 && ny < b.y1 && openBottom) continue;
          if (dy > 0 && ny > b.y2 && openTop) continue;
          assert.ok(S.has(`${x+dx},${ny},${z+dz}`), `${key} shell has a hole next to ${k}`);
        }
      }
      assert.equal(b.y1, 64, `${key} rests at the player's feet`);
      assert.ok(!S.has('0,64,0') && !S.has('0,65,0'), `${key} does not engulf the player`);
      const across = facing.x !== 0 ? [b.z1, b.z2] : [b.x1, b.x2];
      assert.equal(across[0], -across[1], `${key} is centred across the facing`);
    }
  }
  player.getViewDirection = () => ({ x:0, z:1 });
  const sphere = ctx.createShapePlan(player, 'sphere', {radius:6}, 'minecraft:stone', false);
  assert.equal([sphere.bounds.x1, sphere.bounds.x2, sphere.bounds.z1, sphere.bounds.z2, sphere.bounds.y2].join(' '), '-6 6 1 13 76');
  const sphereBlocks = rasterize(ctx, sphere.commands).size;
  const ideal = 4 / 3 * Math.PI * Math.pow(6.5, 3);
  assert.ok(Math.abs(sphereBlocks - ideal) / ideal < 0.1, `sphere volume ${sphereBlocks} vs ${ideal}`);
  const pyramid = ctx.createShapePlan(player, 'pyramid', {base:13}, 'minecraft:stone', false);
  assert.equal(pyramid.bounds.y2 - pyramid.bounds.y1 + 1, 7);
  assert.equal(rasterize(ctx, pyramid.commands).size, 455);
  assert.equal(ctx.createShapePlan(player, 'pyramid', {base:12}, 'minecraft:stone', false).bounds.x2, 6);
  const disc = ctx.createShapePlan(player, 'cylinder', {radius:4, height:1}, 'minecraft:stone', false);
  assert.equal(disc.bounds.y1, disc.bounds.y2);
  const ring = ctx.createShapePlan(player, 'cylinder', {radius:4, height:1}, 'minecraft:stone', true);
  assert.ok(rasterize(ctx, ring.commands).size < rasterize(ctx, disc.commands).size);
  const big = ctx.createShapePlan(player, 'sphere', {radius:25}, 'minecraft:stone', true);
  assert.ok(big.commands.length < 4000 && big.batchSize > 0, 'large shapes are batched');
  assert.equal(big.summary, 'Radius 25');
});

test('a hollow sphere builds over several ticks and undoes', async () => {
  const { ctx, player, dimension, tick, callbacks } = harness();
  const { blocks } = blockWorld(dimension);
  const plan = ctx.createShapePlan(player, 'sphere', {radius:8}, 'minecraft:glass', true);
  let yields = 0;
  const originalRun = ctx.system.run;
  ctx.system.run = fn => { yields++; callbacks.push(fn); };
  await settle(ctx.executeBuildPlan(player, plan, 'shape_sphere', 'Sphere done'), tick);
  ctx.system.run = originalRun;
  assert.ok(player.messages.some(m => m.includes('Sphere done')), player.messages.join('\n'));
  assert.ok(yields >= Math.floor(plan.commands.length / plan.batchSize) - 1);
  assert.equal([...blocks.values()].filter(v => v === 'minecraft:glass').length, rasterize(ctx, plan.commands).size);
  await ctx.executeUndo(player);
  assert.ok(player.messages.some(m => m.includes('Undid')));
});

test('beacon plan stacks mineral layers under a beacon and clears a safe sky column', () => {
  const { ctx, player } = harness();
  const plan = ctx.createBeaconPlan(player, 4, 5, 1, true);
  const parsed = plan.commands.map(c => ctx.parseBlockCommand(c));
  for (let i = 0; i < 4; i++) {
    assert.equal(parsed[i].x2 - parsed[i].x1 + 1, 9 - 2 * i);
    assert.equal(parsed[i].z2 - parsed[i].z1 + 1, 9 - 2 * i);
    assert.equal(parsed[i].y1, 64 + i);
  }
  assert.equal(parsed.slice(0, 4).map(p => p.blockId).join(' '), 'minecraft:iron_block minecraft:gold_block minecraft:emerald_block minecraft:diamond_block');
  assert.equal([parsed[4].blockId, parsed[4].x1, parsed[4].y1, parsed[4].z1].join(' '), 'minecraft:beacon 0 68 5');
  assert.equal([parsed[5].blockId, parsed[5].y1].join(' '), 'minecraft:red_stained_glass 69');
  assert.equal([parsed[6].blockId, parsed[6].x1, parsed[6].x2, parsed[6].y1, parsed[6].y2, parsed[6].z1].join(' '), 'minecraft:air 0 0 70 319 5');
  assert.equal(plan.commands.length, 7);
  assert.equal(plan.bounds.y2, 319);
  const plain = ctx.createBeaconPlan(player, 2, 3, 0, false);
  assert.equal(plain.commands.length, 3);
  assert.ok(plain.commands.slice(0, 2).every(c => c.endsWith('minecraft:diamond_block')));
  assert.equal(plain.bounds.y2, 66);
  assert.equal(ctx.createBeaconPlan(player, 9, 0, 0, false).levels, 4);
  player.dimension = { id: 'minecraft:nether' };
  player.location = { x: 0, y: 40, z: 0 };
  const nether = ctx.createBeaconPlan(player, 1, 0, 0, true);
  assert.equal(ctx.parseBlockCommand(nether.commands[nether.commands.length - 1]).y2, 120);
});

test('swimming pool sinks into the ground with its water level with the surface, builds and undoes', async () => {
  const { ctx, player, dimension, tick, evaluate } = harness();
  const { blocks } = blockWorld(dimension);
  const plan = ctx.createPoolPlan(player, 6, 10, 2, 'minecraft:quartz_block', 'minecraft:smooth_stone', true, true);
  assertCommandsInside(ctx, plan, evaluate('FILL_COMMAND_LIMIT'));
  assert.equal(JSON.stringify(plan.bounds), JSON.stringify({ x1:-4, y1:61, z1:1, x2:5, y2:66, z2:14 }));
  await settle(ctx.executeBuildPlan(player, plan, 'pool', 'Pool done'), tick);
  assert.ok(player.messages.some(m => m.includes('Pool done')), player.messages.join('\n'));
  const water = [...blocks.entries()].filter(([, v]) => v === 'minecraft:water').map(([k]) => k.split(',').map(Number));
  assert.equal(water.length, 6 * 10 * 2);
  assert.ok(water.every(([, y]) => y === 62 || y === 63), 'water fills the two layers up to ground level');
  assert.equal(dimension.getBlock({ x:1, y:61, z:5 }).typeId, 'minecraft:quartz_block');
  assert.equal(dimension.getBlock({ x:-3, y:63, z:2 }).typeId, 'minecraft:quartz_block');
  assert.equal(dimension.getBlock({ x:-4, y:63, z:1 }).typeId, 'minecraft:smooth_stone');
  assert.equal(dimension.getBlock({ x:0, y:64, z:3 }).typeId, 'minecraft:smooth_stone_slab');
  assert.equal([...blocks.values()].filter(v => v === 'minecraft:sea_lantern').length, 5);
  await ctx.executeUndo(player);
  assert.ok(player.messages.some(m => m.includes('Undid')));
  const bare = ctx.createPoolPlan(player, 1, 1, 1, 'minecraft:prismarine', null, true, true);
  assert.equal(bare.commands.length, 4, 'tiny pool: clear, tile, water and one shared lantern');
  assert.ok(!bare.commands.some(c => c.includes('slab')), 'no diving board over a one-block pool');
  assert.ok(!bare.commands.some(c => ctx.parseBlockCommand(c).y1 === 63 && c.endsWith('minecraft:air')));
});

test('house designs build with real doors in every facing and style, then undo', async () => {
  const base = harness();
  const designs = base.evaluate('HOUSE_DESIGNS.map(d => d.key)');
  const paletteCount = base.evaluate('HOUSE_PALETTES.length');
  const limit = base.evaluate('FILL_COMMAND_LIMIT');
  assert.equal(designs.length, 8);
  assert.equal(paletteCount, 7);
  for (let f = 0; f < FACINGS.length; f++) {
    for (const key of designs) {
      const { ctx, player, dimension, tick } = harness();
      player.getViewDirection = () => FACINGS[f];
      const { blocks } = blockWorld(dimension);
      const plan = ctx.createBaseTemplatePlan(player, key, f % paletteCount);
      assertCommandsInside(ctx, plan, limit);
      assert.ok(plan.commands.some(c => /minecraft:[a-z_]*door \["direction"=\d,"door_hinge_bit"=false,"open_bit"=false,"upper_block_bit"=false\]/.test(c)), `${key} has a door`);
      await settle(ctx.executeBuildPlan(player, plan, `house_${key}`, 'House done'), tick);
      assert.ok(player.messages.some(m => m.includes('House done')), `${key}: ${player.messages.join('\n')}`);
      assert.ok(!player.messages.some(m => m.includes('command failed')), key);
      const placed = new Set(blocks.values());
      assert.ok([...placed].some(id => id.endsWith('_door')), `${key} placed a door`);
      assert.ok(placed.has('minecraft:bed'), `${key} has a bed`);
      await ctx.executeUndo(player);
      assert.ok(player.messages.some(m => m.includes('Undid')), key);
    }
  }
  for (let p = 0; p < paletteCount; p++) for (const key of designs) {
    const plan = base.ctx.createHouseDesignPlan(base.player, key, p);
    assert.ok(plan.commands.every(c => base.ctx.parseBlockCommand(c) && !c.includes('undefined')), `${key} in palette ${p}`);
    assert.ok(plan.palette.length > 0);
  }
  assert.equal(base.ctx.createHouseDesignPlan(base.player, 'nope', 0), null);
});

test('starter templates now have doors in their doorways', () => {
  const { ctx, player } = harness();
  for (const [key, door] of [['simple_house', 'minecraft:wooden_door'], ['large_house', 'minecraft:spruce_door'], ['tree_house', 'minecraft:wooden_door']]) {
    const plan = ctx.createBaseTemplatePlan(player, key);
    const doors = plan.commands.filter(c => c.includes(door));
    assert.equal(doors.length, 2, key);
    assert.ok(doors[0].includes('"upper_block_bit"=false') && doors[1].includes('"upper_block_bit"=true'), key);
    const lower = ctx.parseBlockCommand(doors[0]), upper = ctx.parseBlockCommand(doors[1]);
    assert.equal(upper.y1, lower.y1 + 1);
  }
});

test('builder tools menu opens the right tool for every button', async () => {
  const { ctx, player, tick } = harness();
  const titles = [];
  let selection = -1, buttons = 0;
  ctx.ActionFormData = class {
    constructor() { this.count = 0; }
    title(t) { titles.push(t); return this; } body() { return this; }
    button() { this.count++; return this; }
    show() { const chosen = selection; selection = -1; if (titles.length === 1) buttons = this.count; return Promise.resolve({ canceled: chosen < 0, selection: chosen }); }
  };
  modalForm(ctx, titles, null);
  const expected = ['🕳️ Dig an Empty Hole', '🧱 Build / Fill Blocks', '🚜 Flatten / Level Ground', '🪜 Instant Underfoot Platform',
    '🏠 Starter Base Templates', '🏡 House Designs', '🏘️ Build a Modern Village', '🔷 Shapes & Beacons', '🏊 Swimming Pool',
    '🌊 Drain Water & Lava', '⚡ Redstone Contraptions', '🌉 Bridge & Stair Builder', null, '🧹 Area Cleanup', null, '✨ Helper Tools Device ✨'];
  for (let i = 0; i < expected.length; i++) {
    titles.length = 0; player.messages.length = 0; selection = i;
    ctx.openBuilderToolsMenu(player);
    await tick();
    if (expected[i]) assert.equal(titles[1], expected[i], `button ${i}`);
    if (i === 14) assert.ok(player.messages.some(m => m.includes('Nothing to undo')), 'undo button');
    if (i === 12) assert.ok(player.messages.some(m => m.includes('Lit up')), 'light up button');
  }
  assert.equal(buttons, expected.length);
  titles.length = 0; selection = 5;
  ctx.openShapeBuilderMenu(player);
  await tick();
  assert.equal(titles[1], '✨ Beacon with Pyramid Base');
  titles.length = 0; selection = 0;
  ctx.openHouseDesignsMenu(player);
  await tick();
  assert.equal(titles[1], '🏡 Cosy Cottage 🏡');
  titles.length = 0; selection = 1;
  ctx.openContraptionMenu(player);
  await tick();
  assert.equal(titles[1], '🫧 Bubble Elevator');
});

function countBlocks(blocks, predicate) {
  return [...blocks.values()].filter(predicate).length;
}

test('redstone contraptions build in every facing with working parts and undo', async () => {
  const base = harness();
  const keys = base.evaluate('CONTRAPTIONS.map(c => c.key)');
  const limit = base.evaluate('FILL_COMMAND_LIMIT');
  assert.equal(keys.join(' '), 'auto_door bubble_elevator firework_launcher sugar_cane_farm street_lamps railway');
  for (let f = 0; f < FACINGS.length; f++) {
    const { ctx, player, dimension, tick } = harness();
    player.getViewDirection = () => FACINGS[f];
    const { blocks, states } = blockWorld(dimension);
    const alongX = FACINGS[f].x !== 0;
    const plans = {
      auto_door: ctx.createAutoDoorPlan(player, 'minecraft:stone_bricks', f % 2 ? 'buttons' : 'plates'),
      bubble_elevator: ctx.createBubbleElevatorPlan(player, 10, f % 2 === 0),
      firework_launcher: ctx.createFireworkLauncherPlan(player, 4),
      sugar_cane_farm: ctx.createSugarCaneFarmPlan(player, 6),
      street_lamps: ctx.createStreetLampPlan(player, 12),
      railway: ctx.createRailwayPlan(player, 10)
    };
    for (const [key, plan] of Object.entries(plans)) {
      const blockCommands = plan.commands.filter(c => !c.startsWith('replaceitem'));
      assertCommandsInside(ctx, { ...plan, commands: blockCommands }, limit);
      player.messages.length = 0;
      await settle(ctx.executeBuildPlan(player, plan, `contraption_${key}`, `${key} done`), tick);
      assert.ok(player.messages.some(m => m.includes(`${key} done`)), `${key}: ${player.messages.join('\n')}`);
      const placed = new Map(blocks);
      if (key === 'auto_door') {
        assert.equal(countBlocks(placed, v => v === 'minecraft:iron_door'), 2);
        assert.equal(countBlocks(placed, v => v === (f % 2 ? 'minecraft:stone_button' : 'minecraft:stone_pressure_plate')), 2);
      } else if (key === 'bubble_elevator') {
        const shafts = f % 2 === 0 ? 2 : 1;
        assert.equal(countBlocks(placed, v => v === 'minecraft:water'), 10 * shafts);
        assert.equal(countBlocks(placed, v => v === 'minecraft:soul_sand'), 1);
        assert.equal(countBlocks(placed, v => v === 'minecraft:magma'), shafts - 1);
        assert.equal(countBlocks(placed, v => v === 'minecraft:wooden_door'), 2 * shafts);
        assert.equal(plan.bounds.y2 - plan.bounds.y1 + 1, 14);
      } else if (key === 'firework_launcher') {
        assert.equal(countBlocks(placed, v => v === 'minecraft:dispenser'), 4);
        assert.equal(countBlocks(placed, v => v === 'minecraft:redstone_wire'), 4);
        assert.equal(countBlocks(placed, v => v === 'minecraft:stone_button'), 1);
        const loads = plan.commands.filter(c => c.startsWith('replaceitem'));
        assert.equal(loads.length, 12);
        assert.ok(loads.every(c => /^replaceitem block -?\d+ -?\d+ -?\d+ slot\.container [012] minecraft:firework_rocket 64$/.test(c)));
        assert.ok(plan.commands.indexOf(loads[0]) > plan.commands.findIndex(c => c.includes('minecraft:dispenser')), 'dispensers exist before loading');
      } else if (key === 'sugar_cane_farm') {
        assert.equal(countBlocks(placed, v => v === 'minecraft:reeds'), 6);
        assert.equal(countBlocks(placed, v => v === 'minecraft:piston'), 6);
        assert.equal(countBlocks(placed, v => v === 'minecraft:observer'), 6);
        assert.equal(countBlocks(placed, v => v === 'minecraft:sand'), 6);
        assert.equal(countBlocks(placed, v => v === 'minecraft:water'), 1);
        assert.equal(countBlocks(placed, v => v === 'minecraft:hopper'), 2);
        assert.equal(countBlocks(placed, v => v === 'minecraft:chest'), 1);
        const piston = plan.commands.find(c => c.includes('minecraft:piston'));
        const observer = plan.commands.find(c => c.includes('minecraft:observer'));
        const towardsPlayer = { '1,0': [4, 'west'], '-1,0': [5, 'east'], '0,1': [2, 'north'], '0,-1': [3, 'south'] }[`${FACINGS[f].x},${FACINGS[f].z}`];
        assert.ok(piston.includes(`"facing_direction"=${towardsPlayer[0]}`), piston);
        assert.ok(observer.includes(`"minecraft:facing_direction"="${towardsPlayer[1]}"`), observer);
      } else if (key === 'street_lamps') {
        assert.equal(plan.count, 24);
        assert.equal(countBlocks(placed, v => v === 'minecraft:redstone_lamp'), 24);
        assert.equal(countBlocks(placed, v => v === 'minecraft:daylight_detector_inverted'), 24);
        assert.equal(plan.bounds.y1, 64);
        assert.equal(plan.bounds.y2, 67);
      } else if (key === 'railway') {
        assert.equal(countBlocks(placed, v => v === 'minecraft:golden_rail'), 3);
        assert.equal(countBlocks(placed, v => v === 'minecraft:rail'), 7);
        assert.equal(countBlocks(placed, v => v === 'minecraft:redstone_block'), 3);
        assert.ok(plan.commands.some(c => c.includes(`minecraft:rail ["rail_direction"=${alongX ? 1 : 0}]`)));
        assert.ok(plan.commands.some(c => c.includes(`minecraft:golden_rail ["rail_direction"=${alongX ? 1 : 0},"rail_data_bit"=true]`)));
      }
      await ctx.executeUndo(player);
      assert.ok(player.messages.some(m => m.includes('Undid')), key);
      blocks.clear();
      states.clear();
    }
  }
  base.dimension.getBlock = () => ({ isAir: true, typeId: 'minecraft:air' });
  assert.equal(base.ctx.createStreetLampPlan(base.player, 12), null);
  assert.equal(base.ctx.createBubbleElevatorPlan(base.player, 99, false).height, 60);
  assert.equal(base.ctx.createRailwayPlan(base.player, 1).length, 5);
});

test('contraption menu builds from its options form and then gives the railway minecart', async () => {
  const { ctx, player, dimension, tick } = harness();
  blockWorld(dimension);
  const given = [];
  player.getComponent = () => ({ container: { addItem(item) { given.push(item); return undefined; } } });
  ctx.ItemStack = class { constructor(typeId, amount) { this.typeId = typeId; this.amount = amount; } };
  modalForm(ctx, [], [8, true, false]);
  const contraptions = vm.runInContext('CONTRAPTIONS', ctx);
  ctx.openContraptionOptionsMenu(player, contraptions[5]);
  for (let i = 0; i < 10; i++) await tick();
  assert.ok(player.messages.some(m => m.includes('railway built')), player.messages.join('\n'));
  assert.equal(given.length, 1);
  assert.equal(given[0].typeId, 'minecraft:minecart');
  assert.ok(player.messages.some(m => m.includes('minecart was added')));
  player.messages.length = 0;
  dimension.getBlock = () => ({ isAir: true, typeId: 'minecraft:air' });
  modalForm(ctx, [], [12, false]);
  ctx.openContraptionOptionsMenu(player, contraptions[4]);
  for (let i = 0; i < 5; i++) await tick();
  assert.ok(player.messages.some(m => m.includes('No open ground')), player.messages.join('\n'));
});
