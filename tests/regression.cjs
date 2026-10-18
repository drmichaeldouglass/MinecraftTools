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
  dimension.getBlock = () => ({ typeId: 'minecraft:air', isAir: true });
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
      assert.ok(plan.commands.some(c => /minecraft:[a-z_]*door \["minecraft:cardinal_direction"="(north|south|east|west)","door_hinge_bit"=false,"open_bit"=false,"upper_block_bit"=false\]/.test(c)), `${key} has a door`);
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
    '🏠 Starter Base Templates', '🏡 House Designs', '🏘️ Build a Village or City', '🔷 Shapes & Beacons', '🏊 Swimming Pool',
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
  assert.equal(keys.join(' '), 'auto_door bubble_elevator firework_launcher sugar_cane_farm spawner_farm flood_farm wool_farm cobble_generator smelter water_source street_lamps railway');
  for (let f = 0; f < FACINGS.length; f++) {
    const { ctx, player, dimension, tick } = harness();
    player.getViewDirection = () => FACINGS[f];
    const { blocks, states } = blockWorld(dimension);
    const alongX = FACINGS[f].x !== 0;
    const plans = {
      auto_door: ctx.createAutoDoorPlan(player, 'minecraft:stone_bricks', f % 2 ? 'buttons' : 'plates'),
      bubble_elevator: ctx.createBubbleElevatorPlan(player, 10, f % 2 === 0),
      firework_launcher: ctx.createFireworkLauncherPlan(player, 4),
      sugar_cane_farm: ctx.createSugarCaneFarmPlan(player, 6, f % 2),
      spawner_farm: ctx.createSpawnerFarmPlan(player),
      flood_farm: ctx.createFloodFarmPlan(player, 5),
      wool_farm: ctx.createWoolFarmPlan(player),
      cobble_generator: ctx.createCobbleGeneratorPlan(player),
      smelter: ctx.createSmelterPlan(player),
      water_source: ctx.createWaterSourcePlan(player),
      street_lamps: ctx.createStreetLampPlan(player, 12),
      railway: ctx.createRailwayPlan(player, 10)
    };
    for (const [key, plan] of Object.entries(plans)) {
      const blockCommands = plan.commands.filter(c => !c.startsWith('replaceitem') && !c.startsWith('summon'));
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
        assert.equal(countBlocks(placed, v => v === (f % 2 ? 'minecraft:bamboo' : 'minecraft:reeds')), 6);
        assert.equal(plan.crop, f % 2 ? 'bamboo' : 'sugar cane');
        assert.equal(countBlocks(placed, v => v === 'minecraft:piston'), 6);
        assert.equal(countBlocks(placed, v => v === 'minecraft:observer'), 6);
        assert.equal(countBlocks(placed, v => v === 'minecraft:sand'), 6);
        assert.equal(countBlocks(placed, v => v === 'minecraft:water'), 1);
        assert.equal(countBlocks(placed, v => v === 'minecraft:hopper'), 2);
        assert.equal(countBlocks(placed, v => v === 'minecraft:chest'), 1);
        const piston = plan.commands.find(c => c.includes('minecraft:piston'));
        const observer = plan.commands.find(c => c.includes('minecraft:observer'));
        // Bedrock pistons swap their horizontal facing_direction values (2 south, 3 north, 4 east, 5 west).
        const towardsPlayer = { '1,0': [5, 'west'], '-1,0': [4, 'east'], '0,1': [3, 'north'], '0,-1': [2, 'south'] }[`${FACINGS[f].x},${FACINGS[f].z}`];
        assert.ok(piston.includes(`"facing_direction"=${towardsPlayer[0]}`), piston);
        assert.ok(observer.includes(`"minecraft:facing_direction"="${towardsPlayer[1]}"`), observer);
      } else if (key === 'spawner_farm') {
        assert.equal(countBlocks(placed, v => v === 'minecraft:mob_spawner'), 1);
        const waiting = ctx.localPoint(plan.context, 9, 1, 0);
        assert.equal(dimension.getBlock(waiting).typeId, 'minecraft:mob_spawner', 'the spawner waits in front of the sealed room');
        assert.equal(JSON.stringify(plan.spawner), JSON.stringify({ from: waiting, to: ctx.localPoint(plan.context, 9, 5, 7) }));
        assert.equal(dimension.getBlock(plan.spawner.to).typeId, 'minecraft:air');
        assert.equal(countBlocks(placed, v => v === 'minecraft:water'), 19);
        assert.equal(countBlocks(placed, v => v === 'minecraft:chest'), 1);
        const gap = ctx.localPoint(plan.context, 9, 1, 2), pit = ctx.localPoint(plan.context, 9, 1, 3), floor = ctx.localPoint(plan.context, 9, 0, 3);
        assert.equal(dimension.getBlock(gap).typeId, 'minecraft:air');
        assert.equal(dimension.getBlock(pit).typeId, 'minecraft:air');
        assert.equal(dimension.getBlock(floor).typeId, 'minecraft:stone_bricks');
        const stream = ctx.localPoint(plan.context, 9, 4, 11), edge = ctx.localPoint(plan.context, 9, 3, 4);
        assert.equal(dimension.getBlock(stream).typeId, 'minecraft:water');
        assert.equal(dimension.getBlock(edge).typeId, 'minecraft:stone_bricks', 'room floor under the stream');
      } else if (key === 'flood_farm') {
        assert.equal(countBlocks(placed, v => v === 'minecraft:dispenser'), 5);
        assert.equal(countBlocks(placed, v => v === 'minecraft:hopper'), 6);
        assert.equal(countBlocks(placed, v => v === 'minecraft:chest'), 1);
        assert.equal(countBlocks(placed, v => v === 'minecraft:wheat'), 25);
        assert.equal(countBlocks(placed, v => v === 'minecraft:farmland'), 25);
        assert.equal(countBlocks(placed, v => v === 'minecraft:water'), 10);
        assert.equal(countBlocks(placed, v => v === 'minecraft:stone_button'), 1);
        assert.equal(plan.commands.filter(c => /^replaceitem block .* slot\.container 0 minecraft:water_bucket 1$/.test(c)).length, 5);
      } else if (key === 'wool_farm') {
        // Eaten grass only grows back from a neighbouring grass block.
        for (const [x, z] of [[1, 2], [3, 2], [2, 3]]) assert.equal(dimension.getBlock(ctx.localPoint(plan.context, x, 0, z)).typeId, 'minecraft:grass_block');
        assert.equal(dimension.getBlock(ctx.localPoint(plan.context, 2, 0, 1)).typeId, 'minecraft:observer');
        for (const [id, n] of [['minecraft:grass_block', 8], ['minecraft:observer', 1], ['minecraft:dispenser', 1], ['minecraft:rail', 1], ['minecraft:hopper', 2], ['minecraft:chest', 1], ['minecraft:redstone_wire', 1]]) {
          assert.equal(countBlocks(placed, v => v === id), n, id);
        }
        assert.ok(plan.commands.some(c => /^summon minecraft:sheep -?\d+\.5 \d+ -?\d+\.5$/.test(c)));
        assert.ok(plan.commands.some(c => /^summon minecraft:hopper_minecart /.test(c)));
        assert.ok(plan.commands.some(c => c.endsWith('slot.container 0 minecraft:shears 1')));
        assert.ok(plan.commands.indexOf(plan.commands.find(c => c.startsWith('summon minecraft:hopper_minecart'))) > plan.commands.findIndex(c => c.includes('minecraft:rail')), 'rail before cart');
      } else if (key === 'cobble_generator') {
        assert.equal(countBlocks(placed, v => v === 'minecraft:water'), 1);
        assert.equal(countBlocks(placed, v => v === 'minecraft:lava'), 1);
        const lid = ctx.localPoint(plan.context, 4, 1, 1);
        assert.equal(dimension.getBlock(lid).typeId, 'minecraft:smooth_stone', 'lava is covered');
      } else if (key === 'smelter') {
        assert.equal(countBlocks(placed, v => v === 'minecraft:furnace'), 3);
        assert.equal(countBlocks(placed, v => v === 'minecraft:hopper'), 9);
        assert.equal(countBlocks(placed, v => v === 'minecraft:chest'), 9);
      } else if (key === 'water_source') {
        assert.equal(countBlocks(placed, v => v === 'minecraft:water'), 4);
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

test('tapping the waiting spawner with a spawn egg moves it into the sealed farm room', async () => {
  const { ctx, player, dimension, tick, callbacks } = harness();
  const props = {};
  ctx.world.getDynamicProperty = k => props[k];
  ctx.world.setDynamicProperty = (k, v) => { if (v === undefined) delete props[k]; else props[k] = v; };
  const commands = [];
  dimension.runCommand = c => { commands.push(c); return { successCount: 1 }; };
  player.getComponent = () => ({ container: { addItem: () => undefined } });
  ctx.ItemStack = class { constructor(typeId) { this.typeId = typeId; } };
  const plan = ctx.createSpawnerFarmPlan(player);
  const contraption = vm.runInContext('CONTRAPTIONS', ctx).find(c => c.key === 'spawner_farm');
  contraption.after(player, { mob: 0 }, plan);
  assert.equal(JSON.parse(props.pending_farm_spawners).length, 1);
  assert.ok(player.messages.some(m => m.includes('in front of the farm')), player.messages.join('\n'));
  const tap = (location, typeId, item = 'minecraft:zombie_spawn_egg') => ctx.handleFarmSpawnerTap({
    player, block: { typeId, location, dimension }, beforeItemStack: item && { typeId: item }
  });
  tap(plan.spawner.from, 'minecraft:mob_spawner', 'minecraft:diamond');
  tap(plan.spawner.from, 'minecraft:stone');
  tap({ x: 999, y: 64, z: 999 }, 'minecraft:mob_spawner');
  await tick();
  assert.equal(commands.length, 0, 'other blocks, items and spawners are left alone');
  tap(plan.spawner.from, 'minecraft:mob_spawner');
  await tick();
  const { from, to } = plan.spawner;
  assert.deepEqual(commands, [`clone ${from.x} ${from.y} ${from.z} ${from.x} ${from.y} ${from.z} ${to.x} ${to.y} ${to.z} replace move`]);
  await tick();
  assert.ok(player.messages.some(m => m.includes('now in the dark room')), player.messages.join('\n'));
  assert.equal(props.pending_farm_spawners, undefined, 'nothing is left waiting');
  // A failed move keeps the spawner waiting so another tap can retry.
  contraption.after(player, { mob: 0 }, plan);
  dimension.runCommand = () => { throw new Error('unloaded'); };
  tap(plan.spawner.from, 'minecraft:mob_spawner');
  await tick(); await tick();
  assert.ok(player.messages.some(m => m.includes('Could not move the spawner')), player.messages.join('\n'));
  assert.equal(JSON.parse(props.pending_farm_spawners).length, 1);
});

test('contraption menu builds from its options form and then gives the railway minecart', async () => {
  const { ctx, player, dimension, tick } = harness();
  blockWorld(dimension);
  const given = [];
  player.getComponent = () => ({ container: { addItem(item) { given.push(item); return undefined; } } });
  ctx.ItemStack = class { constructor(typeId, amount) { this.typeId = typeId; this.amount = amount; } };
  modalForm(ctx, [], [8, true, false]);
  const contraptions = vm.runInContext('CONTRAPTIONS', ctx);
  const byKey = key => contraptions.find(c => c.key === key);
  ctx.openContraptionOptionsMenu(player, byKey('railway'));
  for (let i = 0; i < 10; i++) await tick();
  assert.ok(player.messages.some(m => m.includes('railway built')), player.messages.join('\n'));
  assert.equal(given.length, 1);
  assert.equal(given[0].typeId, 'minecraft:minecart');
  assert.ok(player.messages.some(m => m.includes('minecart was added')));
  player.messages.length = 0;
  modalForm(ctx, [], [1, false]);
  ctx.openContraptionOptionsMenu(player, byKey('spawner_farm'));
  for (let i = 0; i < 10; i++) await tick();
  assert.ok(player.messages.some(m => m.includes('XP farm built')), player.messages.join('\n'));
  assert.equal(given[1].typeId, 'minecraft:skeleton_spawn_egg');
  player.messages.length = 0;
  modalForm(ctx, [], [false]);
  ctx.openContraptionOptionsMenu(player, byKey('water_source'));
  for (let i = 0; i < 10; i++) await tick();
  assert.ok(player.messages.some(m => m.includes('water source built')), player.messages.join('\n'));
  player.messages.length = 0;
  dimension.getBlock = () => ({ isAir: true, typeId: 'minecraft:air' });
  modalForm(ctx, [], [12, false]);
  ctx.openContraptionOptionsMenu(player, byKey('street_lamps'));
  for (let i = 0; i < 5; i++) await tick();
  assert.ok(player.messages.some(m => m.includes('No open ground')), player.messages.join('\n'));
});

function enchantingHarness() {
  const h = harness();
  const { ctx, player } = h;
  // Match the native API contract: Enchantment.type is an EnchantmentType,
  // not an identifier string. Keep the stored assertions readable with IDs.
  const types = new Map(h.evaluate('ENCHANTMENT_OPTIONS').map(o => [o.id, { id: o.id, maxLevel: o.max }]));
  ctx.EnchantmentTypes = { get: id => types.get(id.replace(/^minecraft:/, '')) };
  function enchantmentId(e) {
    if (!e.type || typeof e.type !== 'object' || types.get(e.type.id) !== e.type) {
      throw new TypeError('Enchantment.type must be an EnchantmentType');
    }
    return e.type.id;
  }
  const conflicts = [['mending', 'infinity'], ['fortune', 'silk_touch'], ['sharpness', 'smite'], ['sharpness', 'bane_of_arthropods'], ['depth_strider', 'frost_walker']];
  class MockItem {
    constructor(typeId, amount = 1) { this.typeId = typeId; this.amount = amount; this.enchantments = []; }
    getComponent(name) {
      if (name !== 'enchantable' || this.typeId.includes('dirt')) return undefined;
      const list = this.enchantments;
      return {
        canAddEnchantment: e => {
          const id = enchantmentId(e);
          return !list.some(x => x.type === id) && !conflicts.some(([a, b]) => (id === a && list.some(x => x.type === b)) || (id === b && list.some(x => x.type === a)));
        },
        addEnchantment: e => {
          const id = enchantmentId(e);
          if (e.level < 1 || e.level > e.type.maxLevel) throw new Error('bad level');
          list.push({ type: id, level: e.level });
        },
        getEnchantments: () => list.slice()
      };
    }
  }
  ctx.ItemStack = MockItem;
  const equipment = {};
  const inventory = [];
  // Inventory slots return copies, as the native container does, so an
  // enchantment only sticks if the script writes the item back.
  const slots = new Array(36).fill(undefined);
  const copy = item => {
    if (!item) return undefined;
    const clone = new MockItem(item.typeId, item.amount);
    clone.enchantments = item.enchantments.slice();
    if (item.nameTag) clone.nameTag = item.nameTag;
    return clone;
  };
  player.getComponent = name => {
    if (name === 'equippable') return { getEquipment: slot => equipment[slot], setEquipment: (slot, item) => { equipment[slot] = item; return true; } };
    if (name === 'inventory') return { container: { size: slots.length, getItem: i => copy(slots[i]), setItem: (i, item) => { slots[i] = copy(item); }, addItem: item => { inventory.push(item); return undefined; } } };
    return undefined;
  };
  return { ...h, MockItem, equipment, inventory, slots };
}

function pickerForm(ctx, picks) {
  const shown = [];
  ctx.ActionFormData = class {
    constructor() { this.buttons = []; shown.push(this); }
    title(t) { this.titleText = t; return this; } body() { return this; }
    button(label) { this.buttons.push(label); return this; }
    show() { const selection = picks.shift(); return Promise.resolve(selection === undefined ? { canceled: true } : { canceled: false, selection }); }
  };
  return shown;
}

test('the enchanting picker lists carried and worn items while the device is in hand', async () => {
  const { ctx, player, tick, MockItem, equipment, slots } = enchantingHarness();
  const device = new MockItem('tools:helper_device');
  device.getComponent = () => undefined;
  slots[0] = device;
  equipment.Mainhand = device;
  slots[2] = new MockItem('minecraft:diamond_sword');
  slots[3] = new MockItem('minecraft:dirt', 64);
  slots[20] = new MockItem('minecraft:bow');
  equipment.Head = new MockItem('minecraft:iron_helmet');
  equipment.Head.enchantments.push({ type: 'protection', level: 4 });
  const shown = pickerForm(ctx, []);
  ctx.openEnchantItemPicker(player);
  await tick();
  const buttons = shown[0].buttons;
  assert.equal(buttons.length, 4, buttons.join(' | '));
  assert.ok(buttons[0].startsWith('Diamond Sword\n') && buttons[0].includes('Hotbar slot 3'), buttons[0]);
  assert.ok(buttons[1].startsWith('Bow\n') && buttons[1].includes('Inventory row 2, slot 3'), buttons[1]);
  assert.ok(buttons[2].startsWith('Iron Helmet\n') && buttons[2].includes('head') && buttons[2].includes('1 enchantment'), buttons[2]);
  assert.ok(buttons[3].includes('Back'));
  assert.ok(!buttons.some(b => /device|dirt/i.test(b)));
});

test('enchanting a picked item applies the chosen level, caps at the top level, or adds everything compatible', async () => {
  const { ctx, player, tick, MockItem, equipment, slots } = enchantingHarness();
  const all = vm.runInContext('ENCHANTMENT_OPTIONS', ctx);
  const device = new MockItem('tools:helper_device');
  device.getComponent = () => undefined;
  slots[0] = device;
  equipment.Mainhand = device;
  slots[4] = new MockItem('minecraft:diamond_sword');
  pickerForm(ctx, [0]);
  modalForm(ctx, [], [all.findIndex(o => o.id === 'sharpness'), 4, false]);
  ctx.openEnchantItemPicker(player);
  await tick();
  assert.equal(JSON.stringify(slots[4].enchantments), JSON.stringify([{ type: 'sharpness', level: 5 }]), 'written back to the slot');
  assert.equal(slots[0], device, 'the device is untouched');
  assert.ok(player.messages.some(m => m.includes('Sharpness') && m.includes(' V')), player.messages.join('\n'));
  const remaining = all.filter(o => o.id !== 'sharpness');
  pickerForm(ctx, [0]);
  modalForm(ctx, [], [remaining.findIndex(o => o.id === 'mending'), 4, false]);
  ctx.openEnchantItemPicker(player);
  await tick();
  assert.equal(slots[4].enchantments[1].level, 1, 'mending is capped at I');
  pickerForm(ctx, [0]);
  modalForm(ctx, [], [0, 0, true]);
  ctx.openEnchantItemPicker(player);
  await tick();
  const ids = slots[4].enchantments.map(e => e.type);
  assert.ok(ids.includes('looting') && ids.includes('unbreaking') && !ids.includes('smite') && !ids.includes('infinity'), ids.join(' '));
  assert.ok(slots[4].enchantments.every(e => e.level === all.find(o => o.id === e.type).max));

  equipment.Feet = new MockItem('minecraft:diamond_boots');
  const shown = pickerForm(ctx, [0]);
  modalForm(ctx, [], [0, 0, true]);
  ctx.openEnchantItemPicker(player);
  await tick();
  assert.ok(shown[0].buttons[0].startsWith('Diamond Boots\n'), 'a sword that cannot take more enchantments is not offered');
  assert.ok(equipment.Feet.enchantments.some(e => e.type === 'feather_falling' && e.level === 4), 'worn boots are enchanted in place');
});

test('the enchanting picker explains when nothing can be enchanted or the item moved', async () => {
  const { ctx, player, tick, MockItem, equipment, slots } = enchantingHarness();
  const device = new MockItem('tools:helper_device');
  device.getComponent = () => undefined;
  slots[0] = device;
  equipment.Mainhand = device;
  slots[1] = new MockItem('minecraft:dirt');
  const shown = pickerForm(ctx, []);
  ctx.openEnchantItemPicker(player);
  await tick();
  assert.equal(shown.length, 0);
  assert.ok(player.messages.some(m => m.includes('Nothing you are carrying')), player.messages.join('\n'));
  slots[5] = new MockItem('minecraft:diamond_pickaxe');
  pickerForm(ctx, [0]);
  ctx.ModalFormData = class {
    title() { return this; } dropdown() { return this; } toggle() { return this; }
    show() { slots[5] = undefined; return Promise.resolve({ canceled: false, formValues: [0, 0, true] }); }
  };
  ctx.openEnchantItemPicker(player);
  await tick();
  assert.ok(player.messages.some(m => m.includes('no longer where it was')), player.messages.join('\n'));
  slots[5] = new MockItem('minecraft:diamond_pickaxe');
  let backTitle;
  ctx.openEnchantMenu = () => { backTitle = 'enchant menu'; };
  pickerForm(ctx, [1]);
  ctx.openEnchantItemPicker(player);
  await tick();
  assert.equal(backTitle, 'enchant menu', 'Back returns to Enchant & Armour');
});

test('armour sets, tool kits and trim kits hand over the right items', () => {
  const { ctx, player, equipment, inventory } = enchantingHarness();
  const armour = ctx.giveArmourSet(player, 4, true, true);
  assert.equal(Object.keys(equipment).sort().join(' '), 'Chest Feet Head Legs');
  assert.equal(equipment.Head.typeId, 'minecraft:diamond_helmet');
  assert.equal(equipment.Feet.typeId, 'minecraft:diamond_boots');
  assert.equal(armour.enchantments, 18);
  assert.ok(equipment.Feet.enchantments.some(e => e.type === 'feather_falling' && e.level === 4));
  assert.ok(player.messages.some(m => m.includes('Diamond armour set') && m.includes('wearing')));
  ctx.giveArmourSet(player, 3, false, false);
  assert.equal(inventory.length, 4);
  assert.equal(inventory[0].typeId, 'minecraft:golden_helmet');
  assert.equal(inventory[0].enchantments.length, 0);
  inventory.length = 0;
  assert.equal(ctx.giveToolKit(player, 5, true), 19);
  assert.equal(inventory.map(i => i.typeId).join(' '), 'minecraft:netherite_sword minecraft:netherite_pickaxe minecraft:netherite_axe minecraft:netherite_shovel minecraft:bow');
  assert.ok(inventory[4].enchantments.some(e => e.type === 'infinity'));
  inventory.length = 0;
  const kit = ctx.giveTrimKit(player, 10, 5, 4);
  assert.equal(kit.pattern.name, 'Silence');
  assert.equal(inventory.map(i => `${i.typeId}x${i.amount}`).join(' '), 'minecraft:silence_armor_trim_smithing_template x4 minecraft:diamondx4 minecraft:smithing_tablex1'.replace(' x4', 'x4'));
  assert.ok(player.messages.some(m => m.includes('smithing table')));
});

test('main and superpowers menus reach the enchanting tools', async () => {
  const { ctx, player, tick } = harness();
  const titles = [];
  let selection = -1;
  ctx.ActionFormData = class {
    title(t) { titles.push(t); return this; } body() { return this; } button() { return this; }
    show() { const chosen = selection; selection = -1; return Promise.resolve({ canceled: chosen < 0, selection: chosen }); }
  };
  selection = 6;
  ctx.openMainMenu(player);
  await tick();
  assert.equal(titles[1], '✨ Enchant & Armour');
  titles.length = 0; selection = 7;
  ctx.openMainMenu(player);
  await tick();
  assert.ok(player.messages.some(m => m.includes('extra device') || m.includes('Could not access your inventory')), player.messages.join('\n'));
  selection = 3;
  ctx.openSuperpowersMenu(player);
  await tick();
  assert.ok(player.commands.includes('xp 30L @s'));
  assert.ok(player.messages.some(m => m.includes('30 experience levels')));
});

test('modern city fits the village snapshot, builds with lifts, towers and furniture in all facings, and undoes', async () => {
  const base = harness();
  const limit = base.evaluate('FILL_COMMAND_LIMIT');
  const size = base.evaluate('VILLAGE_SIZE');
  for (const facing of FACINGS) {
    const { ctx, player, dimension, tick } = harness();
    player.getViewDirection = () => facing;
    const { blocks } = blockWorld(dimension);
    const plan = ctx.createVillagePlan(player, 0, true, 'city', true);
    const b = plan.bounds;
    assert.ok(b.x2 - b.x1 + 1 <= 64 && b.z2 - b.z1 + 1 <= 64 && b.y2 - b.y1 + 1 <= 384, 'city fits one structure snapshot');
    assert.equal(b.x2 - b.x1 + 1, size);
    assertCommandsInside(ctx, plan, limit);
    assert.ok(plan.commands.length > 1500, `city has many commands (${plan.commands.length})`);
    await settle(ctx.executeBuildPlan(player, plan, 'city', 'City done'), tick);
    assert.ok(player.messages.some(m => m.includes('City done')), player.messages.join('\n'));
    assert.ok(!player.messages.some(m => m.includes('command failed')));
    const placed = new Set(blocks.values());
    for (const needed of ['minecraft:soul_sand', 'minecraft:magma', 'minecraft:water', 'minecraft:beacon', 'minecraft:end_rod',
      'minecraft:light_blue_stained_glass', 'tools:chair', 'tools:sofa', 'tools:table', 'tools:lamp', 'tools:tv', 'tools:fridge',
      'tools:computer', 'minecraft:bed', 'minecraft:bell', 'minecraft:poppy']) {
      assert.ok(placed.has(needed), `${needed} placed`);
    }
    // Two lift doors per storey, four room doors per storey above the lobby in the hotel and
    // apartment towers, and ten street entrances.
    const doors = plan.commands.filter(c => c.includes('_door') && c.includes('"upper_block_bit"=false')).length;
    assert.equal(doors, 2 * (10 + 7 + 8 + 12 + 5) + 4 * (6 + 7 + 4) + 10);
    const tallest = Math.max(...plan.commands.map(c => ctx.parseBlockCommand(c).y2));
    assert.ok(tallest >= 63 + 48 + 4 && tallest <= 63 + 56, `skyline height ${tallest}`);
    await ctx.executeUndo(player);
    assert.ok(player.messages.some(m => m.includes('Undid')));
  }
  const plain = base.ctx.createVillagePlan(base.player, 1, false, 'city', false);
  assert.ok(!plain.commands.some(c => c.includes('tools:')), 'furniture can be switched off');
  assert.ok(plain.commands.some(c => c.includes('minecraft:lectern')) && plain.commands.some(c => c.includes('weirdo_direction')));
  assert.equal(plain.layout, 'city');
  const village = base.ctx.createVillagePlan(base.player, 0, true);
  assert.equal(village.layout, 'village');
  assert.ok(village.commands.some(c => c.includes('tools:tv ["minecraft:cardinal_direction"=')));
  assert.ok(village.commands.some(c => c.includes('tools:fridge')));
  assert.ok(!base.ctx.createVillagePlan(base.player, 0, true, 'village', false).commands.some(c => c.includes('tools:')));
  assert.ok(!base.ctx.createHouseDesignPlan(base.player, 'cottage', 0, false).commands.some(c => c.includes('tools:')));
  assert.ok(base.ctx.createHouseDesignPlan(base.player, 'cottage', 0).commands.some(c => c.includes('tools:lamp')));
});

test('village and city menu passes layout, furniture and ground choices through', async () => {
  const { ctx, player, tick } = harness();
  let received;
  ctx.createVillagePlan = (p, palette, ground, layout, furniture) => {
    received = { palette, ground, layout, furniture };
    return { name: 'x', dimensionId: p.dimension.id, commands: [], bounds: previewBounds, palette: 'P', layout };
  };
  ctx.executeBuildPlan = () => Promise.resolve(true);
  modalForm(ctx, [], [1, 2, false, false, false]);
  ctx.openVillageBuilderMenu(player);
  await tick();
  assert.equal(JSON.stringify(received), JSON.stringify({ palette: 2, ground: false, layout: 'city', furniture: false }));
  assert.ok(player.messages.some(m => m.includes('modern city is built')));
});

test('furniture blocks are defined consistently across both packs', () => {
  const bpDir = path.join(__dirname, '../Behavior_Pack/blocks');
  const rpDir = path.join(__dirname, '../Resource_Pack');
  const terrain = JSON.parse(fs.readFileSync(path.join(rpDir, 'textures/terrain_texture.json'))).texture_data;
  const blocksJson = JSON.parse(fs.readFileSync(path.join(rpDir, 'blocks.json')));
  const lang = fs.readFileSync(path.join(rpDir, 'texts/en_US.lang'), 'utf8');
  const { ctx, evaluate } = harness();
  const furniture = evaluate('Object.values(FURNITURE_BLOCKS)');
  const defined = [];
  for (const file of fs.readdirSync(bpDir)) {
    const block = JSON.parse(fs.readFileSync(path.join(bpDir, file)))['minecraft:block'];
    const id = block.description.identifier;
    defined.push(id);
    const geometryId = block.components['minecraft:geometry'];
    const geoFile = path.join(rpDir, 'models/blocks', `${geometryId.replace('geometry.', '')}.geo.json`);
    const geometry = JSON.parse(fs.readFileSync(geoFile))['minecraft:geometry'][0];
    assert.equal(geometry.description.identifier, geometryId, file);
    const materials = block.components['minecraft:material_instances'];
    assert.ok(materials['*'], `${file} has a default material`);
    for (const [name, material] of Object.entries(materials)) {
      assert.ok(terrain[material.texture], `${file} material ${name} texture ${material.texture} is in terrain_texture.json`);
      assert.ok(fs.existsSync(path.join(rpDir, terrain[material.texture].textures + '.png')), `${material.texture} png exists`);
    }
    for (const bone of geometry.bones) for (const cube of bone.cubes) {
      for (const [face, uv] of Object.entries(cube.uv)) {
        if (uv.material_instance) assert.ok(materials[uv.material_instance], `${file} ${face} material ${uv.material_instance} defined`);
      }
      for (let axis = 0; axis < 3; axis++) {
        const lo = cube.origin[axis], hi = lo + cube.size[axis];
        if (axis === 1) assert.ok(lo >= 0 && hi <= 16, `${file} cube inside block height`);
        else assert.ok(lo >= -8 && hi <= 8, `${file} cube inside block footprint`);
      }
    }
    for (const key of ['minecraft:collision_box', 'minecraft:selection_box']) {
      const box = block.components[key];
      assert.ok(box.origin[1] >= 0 && box.origin[1] + box.size[1] <= 16 && box.origin[0] >= -8 && box.origin[0] + box.size[0] <= 8 && box.origin[2] >= -8 && box.origin[2] + box.size[2] <= 8, `${file} ${key}`);
    }
    const traits = block.description.traits;
    if (traits) {
      assert.deepEqual(Object.keys(traits), ['minecraft:placement_direction']);
      const rotations = block.permutations.map(p => p.components['minecraft:transformation'].rotation[1]).sort((a, b) => a - b);
      assert.equal(rotations.join(' '), '0 90 180 270');
      for (const d of ['north', 'south', 'east', 'west']) assert.ok(block.permutations.some(p => p.condition.includes(`'${d}'`)), `${file} rotates ${d}`);
    }
    assert.ok(blocksJson[id], `${id} in blocks.json`);
    assert.ok(lang.includes(`tile.${id}.name=`), `${id} has a name`);
  }
  assert.equal(furniture.slice().sort().join(' '), defined.sort().join(' '));
  for (const id of ['tools:chair', 'tools:tv']) {
    const block = JSON.parse(fs.readFileSync(path.join(bpDir, `${id.replace('tools:', 'tools_')}.json`)))['minecraft:block'];
    assert.ok(block.description.traits, `${id} is directional`);
  }
  assert.ok(ctx.parseBlockCommand('setblock 0 64 0 tools:chair ["minecraft:cardinal_direction"="north"]'));
});

test('unknown enchantments are rejected without modifying the item', () => {
  const { ctx, MockItem } = enchantingHarness();
  const item = new MockItem('minecraft:diamond_sword');
  assert.equal(ctx.canEnchant(item, 'missing_enchantment'), false);
  assert.equal(ctx.applyEnchantment(item, 'missing_enchantment', 5), false);
  assert.equal(item.enchantments.length, 0);
});

test('auto-equip preserves occupied slots and gives the remaining armour pieces', () => {
  const { ctx, player, MockItem, equipment, inventory } = enchantingHarness();
  const oldHelmet = new MockItem('minecraft:netherite_helmet');
  oldHelmet.nameTag = 'Keep my helmet';
  oldHelmet.enchantments.push({ type: 'protection', level: 4 });
  const elytra = new MockItem('minecraft:elytra');
  equipment.Head = oldHelmet;
  equipment.Chest = elytra;
  const result = ctx.giveArmourSet(player, 4, false, true);
  assert.equal(equipment.Head, oldHelmet);
  assert.equal(equipment.Chest, elytra);
  assert.equal(equipment.Legs.typeId, 'minecraft:diamond_leggings');
  assert.equal(equipment.Feet.typeId, 'minecraft:diamond_boots');
  assert.equal(result.outcomes.equipped, 2);
  assert.equal(result.outcomes.given, 2);
  assert.deepEqual(inventory.map(i => i.typeId), ['minecraft:diamond_helmet', 'minecraft:diamond_chestplate']);
});

test('occupied armour stays equipped when the inventory is full', () => {
  const { ctx, player, MockItem, equipment, dimension } = enchantingHarness();
  const oldHelmet = new MockItem('minecraft:netherite_helmet');
  equipment.Head = oldHelmet;
  const getComponent = player.getComponent;
  player.getComponent = name => name === 'inventory'
    ? { container: { addItem: item => item } } : getComponent(name);
  const dropped = [];
  dimension.spawnItem = item => dropped.push(item);
  const newHelmet = new MockItem('minecraft:diamond_helmet');
  assert.equal(ctx.equipOrGive(player, newHelmet, 'Head'), 'dropped');
  assert.equal(equipment.Head, oldHelmet);
  assert.deepEqual(dropped, [newHelmet]);
});

test('draining stops on real failures, reports them, and preserves undo', async () => {
  for (const unavailable of [false, true]) {
    const { ctx, player, dimension, tick } = harness();
    const commands = [];
    dimension.getBlock = () => {
      if (unavailable) throw new Error('chunk unloaded');
      return { typeId: 'minecraft:water', isAir: false };
    };
    dimension.runCommand = command => {
      commands.push(command);
      if (command.startsWith('fill')) throw new Error('drain failed');
      return { successCount: 1 };
    };
    const plan = ctx.createDrainPlan(player, 3, 2);
    const completed = await settle(ctx.executeBuildPlan(player, plan, 'drain', 'Drained'), tick);
    assert.equal(completed, false);
    assert.ok(player.messages.some(m => m.includes('command failed')));
    assert.ok(!player.messages.some(m => m.includes('Drained')));
    assert.equal(commands.filter(c => c.startsWith('fill')).length, 1);
    await ctx.executeUndo(player);
    assert.ok(commands.some(c => c.startsWith('structure load')));
  }
});

test('flood farm places support blocks before redstone in every facing and width', () => {
  for (const facing of FACINGS) for (const width of [3, 6, 9]) {
    const { ctx, player } = harness();
    player.getViewDirection = () => facing;
    const plan = ctx.createFloodFarmPlan(player, width);
    const placed = new Map();
    let wires = 0;
    for (const command of plan.commands) {
      const c = ctx.parseBlockCommand(command);
      if (!c) continue;
      for (let x = c.x1; x <= c.x2; x++) for (let y = c.y1; y <= c.y2; y++) for (let z = c.z1; z <= c.z2; z++) {
        if (c.blockId === 'minecraft:redstone_wire') {
          const below = placed.get(`${x},${y - 1},${z}`);
          assert.ok(below && below !== 'minecraft:air', `wire at ${x},${y},${z} must already have support`);
          wires++;
        }
        placed.set(`${x},${y},${z}`, c.blockId);
      }
    }
    assert.equal(wires, width);
  }
});

// Replays block commands in order and returns every single-block placement that
// a later command replaces with something else.
function overwrittenPlacements(ctx, commands) {
  const owner = new Map();
  const lost = [];
  commands.forEach((command, i) => {
    const c = ctx.parseBlockCommand(command);
    if (!c) return;
    const single = c.x1 === c.x2 && c.y1 === c.y2 && c.z1 === c.z2;
    for (let x = c.x1; x <= c.x2; x++) for (let y = c.y1; y <= c.y2; y++) for (let z = c.z1; z <= c.z2; z++) {
      const boundary = x === c.x1 || x === c.x2 || y === c.y1 || y === c.y2 || z === c.z1 || z === c.z2;
      if (c.mode === 'outline' && !boundary) continue;
      const key = `${x},${y},${z}`;
      const prev = owner.get(key);
      if (c.mode === 'keep' && prev && prev.block !== 'minecraft:air') continue;
      if (c.filterId && (!prev || prev.block !== c.filterId)) continue;
      const block = c.mode === 'hollow' && !boundary ? 'minecraft:air' : c.blockId;
      // Without custom furniture a desk computer (lectern) deliberately replaces the table's pressure plate.
      const standIn = prev && prev.block === 'minecraft:wooden_pressure_plate' && block === 'minecraft:lectern';
      if (prev && prev.single && prev.block !== block && prev.block !== 'minecraft:air' && !standIn) {
        lost.push(`${commands[prev.i]} replaced by ${command}`);
      }
      owner.set(key, { i, block, single });
    }
  });
  return lost;
}

test('no door, lamp, light or furniture placed by a build is overwritten later in the same build', () => {
  for (const facing of FACINGS) {
    const { ctx, player, evaluate } = harness();
    player.getViewDirection = () => facing;
    const plans = [];
    for (const key of ['simple_house', 'large_house', 'fort', 'tree_house', 'bunker']) plans.push([key, ctx.createBaseTemplatePlan(player, key)]);
    for (const key of evaluate('HOUSE_DESIGNS.map(d => d.key)')) for (const furniture of [true, false]) {
      plans.push([`${key} furniture=${furniture}`, ctx.createHouseDesignPlan(player, key, 0, furniture)]);
    }
    for (const layout of ['village', 'city']) for (const furniture of [true, false]) {
      plans.push([`${layout} furniture=${furniture}`, ctx.createVillagePlan(player, 0, true, layout, furniture)]);
    }
    for (const [name, plan] of plans) assert.deepEqual(overwrittenPlacements(ctx, plan.commands), [], name);
  }
});

test('doors use the cardinal direction state that replaced the integer direction', () => {
  for (const facing of FACINGS) {
    const { ctx, player, evaluate } = harness();
    player.getViewDirection = () => facing;
    const plans = [ctx.createBaseTemplatePlan(player, 'simple_house'), ctx.createAutoDoorPlan(player, 'minecraft:stone_bricks', 'plates')];
    for (const key of evaluate('HOUSE_DESIGNS.map(d => d.key)')) plans.push(ctx.createHouseDesignPlan(player, key, 0));
    for (const plan of plans) {
      const doors = plan.commands.filter(c => /_door /.test(c));
      assert.ok(doors.length >= 2);
      for (const door of doors) {
        assert.ok(!/"direction"=/.test(door), door);
        assert.ok(/"minecraft:cardinal_direction"="(north|south|east|west)"/.test(door), door);
      }
    }
    // A door walked through away from the player keeps the orientation the integer state used to give.
    const door = ctx.createBaseTemplatePlan(player, 'simple_house').commands.find(c => c.includes('wooden_door'));
    const expected = { '1,0': 'south', '0,1': 'west', '-1,0': 'north', '0,-1': 'east' }[`${facing.x},${facing.z}`];
    assert.ok(door.includes(`"minecraft:cardinal_direction"="${expected}"`), door);
  }
});

test('tree house keeps both halves of its door and its stairs reach the threshold', async () => {
  for (const facing of FACINGS) {
    const { ctx, player, dimension } = harness();
    player.getViewDirection = () => facing;
    const { blocks, states } = blockWorld(dimension);
    const plan = ctx.createBaseTemplatePlan(player, 'tree_house');
    await ctx.executeBuildPlan(player, plan, 'tree_house', 'done');
    const at = (x, y, z) => ctx.localPoint(plan.context, x, y, z);
    const key = p => `${p.x},${p.y},${p.z}`;
    assert.equal(blocks.get(key(at(5, 8, 6))), 'minecraft:wooden_door');
    assert.equal(states.get(key(at(5, 8, 6))).upper_block_bit, false);
    assert.equal(blocks.get(key(at(5, 9, 6))), 'minecraft:wooden_door');
    assert.equal(states.get(key(at(5, 9, 6))).upper_block_bit, true);
    assert.equal(blocks.get(key(at(5, 7, 6))), 'minecraft:oak_planks', 'threshold under the door');
    for (let step = 0; step <= 5; step++) {
      assert.equal(blocks.get(key(at(5, step + 1, step))), 'minecraft:oak_planks', `step ${step}`);
      for (let h = 2; h <= 4; h++) assert.equal(dimension.getBlock(at(5, step + h, step)).typeId, 'minecraft:air', `headroom ${step}/${h}`);
    }
  }
});

test('staircases clear three blocks of headroom so they can be walked in solid ground', async () => {
  for (const direction of ['up', 'down']) for (const facing of FACINGS) {
    const { ctx, player, dimension } = harness();
    player.getViewDirection = () => facing;
    player.location = { x: 0, y: 40, z: 0 };
    const { blocks } = blockWorld(dimension);
    const plan = ctx.createStairPlan(player, 3, 6, 'minecraft:stone_bricks', direction, true);
    await ctx.executeBuildPlan(player, plan, 'stairs', 'done');
    assert.ok(player.messages.some(m => m.includes('done')), player.messages.join('\n'));
    const c = ctx.createOrientedBuildContext(player, 3, 6, -1);
    for (let step = 0; step < 6; step++) {
      const y = direction === 'down' ? -step : step;
      assert.equal(blocks.get(Object.values(ctx.localPoint(c, 1, y, step)).join(',')), 'minecraft:stone_bricks');
      for (let h = 1; h <= 3; h++) assert.equal(dimension.getBlock(ctx.localPoint(c, 1, y + h, step)).typeId, 'minecraft:air', `${direction} ${step}/${h}`);
    }
  }
});

test('bunker stairs have three blocks of headroom', () => {
  const { ctx, player } = harness();
  const plan = ctx.createBaseTemplatePlan(player, 'bunker');
  for (let step = 0; step <= 6; step++) {
    const clear = plan.commands.find(cmd => cmd === ctx.fillLocal(plan.context, 4, -step + 1, step, 6, -step + 3, step, 'minecraft:air'));
    assert.ok(clear, `step ${step}`);
  }
});

test('cobblestone generator keeps the water away from the lava source', () => {
  for (const facing of FACINGS) {
    const { ctx, player } = harness();
    player.getViewDirection = () => facing;
    const plan = ctx.createCobbleGeneratorPlan(player);
    const final = new Map();
    for (const command of plan.commands) {
      const c = ctx.parseBlockCommand(command);
      for (let x = c.x1; x <= c.x2; x++) for (let y = c.y1; y <= c.y2; y++) for (let z = c.z1; z <= c.z2; z++) final.set(`${x},${y},${z}`, c.blockId);
    }
    const get = (x, y, z) => final.get(Object.values(ctx.localPoint(plan.context, x, y, z)).join(','));
    assert.equal(get(1, 0, 1), 'minecraft:water');
    assert.equal(get(2, 0, 1), 'minecraft:air', 'water flows here');
    assert.equal(get(2, -1, 1), 'minecraft:air', 'and falls into the pit instead of reaching the lava');
    assert.equal(get(2, -2, 1), 'minecraft:smooth_stone', 'pit floor');
    assert.equal(get(3, 0, 1), 'minecraft:air', 'cobblestone forms here');
    assert.equal(get(3, -1, 1), 'minecraft:smooth_stone');
    assert.equal(get(4, 0, 1), 'minecraft:lava');
  }
});

test('a failed snapshot does not tell the player to undo a previous build', async () => {
  const { ctx, player, dimension } = harness();
  dimension.runCommand = () => { throw new Error('unloaded'); };
  const plan = ctx.createBaseTemplatePlan(player, 'simple_house');
  assert.equal(await ctx.executeBuildPlan(player, plan, 'simple_house', 'done'), false);
  assert.ok(player.messages.some(m => m.includes('nothing was built')));
  assert.ok(!player.messages.some(m => m.includes('Undo')));
});
