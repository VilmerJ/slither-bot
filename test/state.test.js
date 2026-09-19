import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readClientState, validateState } from '../src/state.js';
import { aimPoint, validateAction } from '../src/actions.js';

function clientFixture() {
  const self = { id: 7, nk: 'self', xx: 100, yy: 200, fx: 2, fy: -3, ang: 0, wang: 0.2,
    sp: 5, ssp: 5, msp: 12, sc: 1, scang: 0.8, spang: 1, sct: 2, fam: 0.5, wmd: false, pts: [
      { xx: 50, yy: 200, fx: 1, fy: 0, dying: true }, { xx: 80, yy: 200, fx: 0, fy: 0 },
    ] };
  const other = { ...self, id: 8, nk: 'other', xx: 11000, dead: true };
  const pixels = new Uint8ClampedArray(16); pixels[3] = 255; pixels[15] = 255;
  return {
    slither: self, slithers: [other, self], foods_c: 2,
    foods: [{ id: -99, xx: 90, yy: 90, sz: 5, cv: 3, sx: 0, sy: 0 },
      { id: 102, xx: 120, yy: 90, sz: 4, sx: 0, sy: 0, eaten: true, eaten_by: self },
      { id: 999, xx: 0, yy: 0 }],
    preys: [{ id: 23, xx: 130, yy: 140, sz: 5, ang: 1, wang: 2, sp: 3, eaten: false }],
    playing: true, connected: true, connecting: false, dead_mtm: -1, ws: { readyState: 1 },
    sectors: [{ xx: 1, yy: 2 }], grd: 500, flux_grd: 450, real_flux_grd: 440, sector_size: 100,
    protocol_version: 19, mamu: 0.04, fpsls: [0, 1, 2], fmlts: [1, 1, 0.5],
    mmgad: true, mmsz: 2, asmc2: { getContext: () => ({ getImageData: () => ({ data: pixels }) }) },
    innerWidth: 1280, innerHeight: 800, view_xx: 100, view_yy: 200, gsc: 1, follow_view: true,
    document: { scripts: [{ src: 'https://slither.io/s/game1107249518.js' }] },
  };
}
const read = fixture => JSON.parse(JSON.stringify(vm.runInNewContext(`(${readClientState.toString()})()`, fixture)));

test('serializable observation contains all loaded entities, including offscreen snakes and body points', () => {
  const state = validateState(read(clientFixture()));
  assert.equal(state.status, 'playing');
  assert.equal(state.self.id, 7);
  assert.equal(state.snakes.length, 2);
  assert.equal(state.snakes[0].head.x, 11000);
  assert.equal(state.snakes[0].alive, false);
  assert.equal(state.self.body.length, 2);
  assert.equal(state.self.body[0].dying, true);
  assert.deepEqual(state.self.renderHead, { x: 102, y: 197 });
  assert.equal(state.food.length, 2); // Unused backing-array slots must be excluded.
  assert.equal(state.food[0].id, -99);
  assert.equal(state.food[1].eatenBy, 7);
  assert.equal(state.prey[0].id, 23);
  assert.deepEqual(state.minimap.cells, [1, 0, 0, 1]);
  assert.equal(state.minimap.identifiesEntities, false);
  assert.equal(state.coverage.fullWorld, false);
  assert.equal(state.coverage.foodSectors.length, 1);
  assert.equal(state.arena.radius, 440);
  assert.equal(state.self.score, 25);
  assert.equal(state.self.turnRate, 4);
});

test('death takes precedence over playing during the client death animation', () => {
  const fixture = clientFixture(); fixture.dead_mtm = 123;
  assert.equal(read(fixture).status, 'dead');
  assert.equal(read(fixture).self.alive, false);
});

test('menu, connecting, and unavailable minimap are explicit', () => {
  const fixture = clientFixture();
  fixture.slither = null; fixture.slithers = []; fixture.playing = false; fixture.mmgad = false;
  assert.equal(read(fixture).status, 'menu');
  assert.equal(read(fixture).self, null);
  assert.equal(read(fixture).minimap, null);
  fixture.want_play = true;
  assert.equal(read(fixture).status, 'connecting');
});

test('socket loss during play is distinguished from a game death', () => {
  const fixture = clientFixture();
  fixture.ws.readyState = 3; fixture.connected = false; fixture.dead_mtm = 123;
  assert.equal(read(fixture).status, 'disconnected');
});

test('player statistics remain unknown until the server provides a leaderboard update', () => {
  const fixture = clientFixture();
  fixture.rank = 0; fixture.slither_count = 0; fixture.best_rank = 999999999;
  assert.deepEqual(read(fixture).stats, { rank: null, totalPlayers: null, bestRank: null });
  fixture.rank = 180; fixture.slither_count = 287; fixture.best_rank = 174;
  assert.deepEqual(read(fixture).stats, { rank: 180, totalPlayers: 287, bestRank: 174 });
});

test('client incompatibility and invalid active state fail clearly', () => {
  assert.throws(() => read({}), /Unsupported Slither.io client/);
  const fixture = clientFixture(); fixture.slither.xx = NaN;
  assert.throws(() => validateState(read(fixture)), /valid player position/);
});

test('actions normalize radians, reject invalid input, and aim inside the viewport', () => {
  assert.deepEqual(validateAction({ heading: -Math.PI / 2 }), { heading: 3 * Math.PI / 2, boost: false });
  for (const action of [null, {}, { heading: Infinity }, { heading: 0, boost: 'yes' }]) assert.throws(() => validateAction(action));
  assert.deepEqual(aimPoint(0, 1280, 800), { x: 920, y: 400 });
  assert.deepEqual(aimPoint(Math.PI / 2, 1280, 800), { x: 640, y: 680 });
});
