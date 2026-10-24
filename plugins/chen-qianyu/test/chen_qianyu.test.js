import { test } from 'node:test';
import assert from 'node:assert/strict';

// Run with `node tools/plugin.mjs test chen-qianyu`: it installs this plugin's content and SDK registrations before this
// module (SP_PLUGIN_TEST_SET). Anywhere else — a plain `node --test` of the repository finds this file too — it skips.
const run = process.env.SP_PLUGIN_TEST_SET ? {} : { skip: 'run with node tools/plugin.mjs test chen-qianyu' };

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

async function fight(form, hpMul, count = 14) {
  const { makeBattle, checkInvariants } = await import('../../../test/helpers/battleHarness.js');
  const h = makeBattle({
    seed: 7, timeLimit: 120,
    units: [
      { chessId: `chess_x_chen_qianyu_chen_${form}`, row: 9, col: 5 },
      { chessId: 'chess_char_1_01_a', row: 10, col: 4 },   // 隐现, 狙击 (速射手)
      { chessId: 'chess_char_1_09_a', row: 11, col: 4 },   // 跃跃, 狙击 (回环射手)
      { chessId: 'chess_char_1_03_a', row: 10, col: 3 },   // 惊蛰, 术师: no resonance
    ],
    enemies: [{ key: 'enemy_1422_lrsldr', time: 0, route: 0, count, interval: 1.2, mods: { hpMul } }],
    hooks: ['skillStart', 'statusApplied', 'damaged', 'hit', 'death', 'heal'],
    captureNoisy: true,
  });
  h.step();
  const units = ['chess_char_1_01_a', 'chess_char_1_09_a', 'chess_char_1_03_a'].map((id) => h.unit(id));
  return { h, checkInvariants, chen: h.unit(`chess_x_chen_qianyu_chen_${form}`), units };
}

// 【钢板】: the bond's tier is the match's count (Battle players[].bonds); every member, normal or elite, gains ASPD and DEF
test('【钢板】 members gain +20 / +40 / +70 / +100 ASPD and +200 / +400 / +600 / +1800 DEF at tiers 1–4 (2 / 4 / 6 / 8 members)', run, async () => {
  const { makeBattle, checkInvariants } = await import('../../../test/helpers/battleHarness.js');
  // the match host installs operator traits (server/match/host/entry.js); the CLI test preload does not
  const { getData } = await import('../../../server/data.js');
  const { installServerOperatorTraits } = await import('../../../server/plugins/operatorTraits.js');
  await installServerOperatorTraits(getData());
  const BID = 'bond_x_chen_qianyu_gangban';
  // 陈千语, 诗怀雅, 莫斯提马 (elite), 能天使, 塑心, 缪尔赛思, 德克萨斯, 拉普兰德, 惊蛰
  const ids = ['chess_x_chen_qianyu_chen_a', 'chess_char_3_03_a', 'chess_char_4_02_b', 'chess_char_3_01_a',
    'chess_char_6_09_a', 'chess_char_6_11_a', 'chess_char_1_08_a', 'chess_char_2_16_a', 'chess_char_1_03_a'];
  const statsAt = (tier) => {
    const h = makeBattle({
      seed: 7, timeLimit: 30,
      units: ids.map((chessId, i) => ({ chessId, row: 9 + (i % 2), col: 3 + i })),
      bonds: tier ? { [BID]: { count: [2, 4, 6, 8][tier - 1], active: true, tier, layers: 0 } } : {},
    });
    h.step();
    checkInvariants(h.b);
    return ids.map((id) => ({ aspd: h.unit(id).s.aspd, def: h.unit(id).s.def }));
  };
  const off = statsAt(0);
  for (const [tier, aspd, def] of [[1, 20, 200], [2, 40, 400], [3, 70, 600], [4, 100, 1800]]) {
    const on = statsAt(tier);
    const members = ids.length - 1;
    assert.deepEqual(on.map((v, i) => v.aspd - off[i].aspd), [...Array(members).fill(aspd), 0], `tier ${tier}: members +${aspd} ASPD, 惊蛰 (not a member) +0`);
    assert.deepEqual(on.map((v, i) => v.def - off[i].def), [...Array(members).fill(def), 0], `tier ${tier}: members +${def} DEF, 惊蛰 +0`);
  }
});

test('【钢板】 active layers give every member +20 DEF each and follow in-battle gains', run, async () => {
  const { makeBattle, checkInvariants } = await import('../../../test/helpers/battleHarness.js');
  const { getData } = await import('../../../server/data.js');
  const { installServerOperatorTraits } = await import('../../../server/plugins/operatorTraits.js');
  await installServerOperatorTraits(getData());
  const BID = 'bond_x_chen_qianyu_gangban';
  const ids = ['chess_x_chen_qianyu_chen_a', 'chess_char_3_01_a', 'chess_char_1_03_a']; // 陈千语, 能天使, 惊蛰
  const battle = (layers) => {
    const h = makeBattle({
      seed: 7, timeLimit: 30,
      units: ids.map((chessId, i) => ({ chessId, row: 9, col: 4 + i })),
      bonds: { [BID]: { count: 2, active: true, tier: 1, layers } },
      hooks: ['layerGain'], captureNoisy: true,
    });
    h.step();
    return h;
  };
  const base = battle(0), h = battle(3);
  const baseDef = ids.map((id) => base.unit(id).s.def);
  assert.deepEqual(ids.map((id, i) => h.unit(id).s.def - baseDef[i]), [60, 60, 0], 'three layers: members +60 DEF, non-member +0');

  assert.equal(h.b.addLayers('p1', BID, 2, 'test'), 2);
  h.step(2); // layerGain fires before the live layer count changes; the plugin refreshes on the deferred tick
  assert.deepEqual(ids.map((id, i) => h.unit(id).s.def - baseDef[i]), [100, 100, 0], 'five live layers: members +100 DEF, non-member +0');
  assert.equal(h.unit(ids[0]).buffs.filter((b) => b.key === 'chen-qianyu:gangban:layers').length, 1, 'refresh replaces the layer buff');
  checkInvariants(h.b);
});

for (const [form, f] of [['a', 0], ['b', 1]]) {
  const name = form === 'a' ? 'normal' : 'elite';

  test(`陈千语 ${name}: Blade Gale (the elite 5× the normal) and 锋刃`, run, async () => {
    const { h, checkInvariants, chen } = await fight(form, [8, 60][f]);
    assert.notEqual(chen.kit.generic, true, 'the script kit is installed');
    assert.equal(chen.skill.kind, 'instant');
    h.run(5);
    const atk = chen.s.atk;
    const before = { hit: h.hooksOf('hit').length, damaged: h.hooksOf('damaged').length, heal: h.hooksOf('heal').length };
    h.runUntil(() => h.hooksOf('skillStart').some((e) => e.unit === chen), 60);
    h.runUntil(() => h.hooksOf('statusApplied').some((e) => e.source === chen && e.status === 'stun'), 5);
    const stuns = h.hooksOf('statusApplied').filter((e) => e.source === chen && e.status === 'stun');
    assert.ok(stuns.length >= 1, 'the final strike stuns');
    close(stuns[0].duration, [1, 1.5][f]);
    // 锋刃: a stack per skill hit — the 6 slashes reach the 5, so the final strike has their ATK
    assert.equal(chen.findBuff('chen-qianyu:edge').stacks, 5);
    const atkStacked = chen.s.atk;
    close(atkStacked / atk, 1 + 5 * [0.04, 0.08][f]);
    // 6 slashes and the final strike, × ATK before DEF: the first slash without a stack, the final strike with 5
    const skillHits = h.hooksOf('hit').slice(before.hit).filter((e) => e.credit === chen && e.dmg.isSkill).map((e) => e.dmg.amount);
    close(Math.min(...skillHits) / atk, [0.6, 3.0][f]);
    close(Math.max(...skillHits) / atkStacked, [3.0, 15.0][f]);
    // 锋刃 heal: the n-th skill hit heals her min(n, 5) × 4% (elite 6%) of the damage it dealt
    const dealt = h.hooksOf('damaged').slice(before.damaged)
      .filter((e) => (e.credit ?? e.source) === chen && e.dmg?.isSkill && e.target.side === 'enemy' && e.amount > 0).map((e) => e.amount);
    const heals = h.hooksOf('heal').slice(before.heal).filter((e) => e.source === chen && e.target === chen).map((e) => e.amount);
    assert.equal(dealt.length, 7, 'the 6 slashes and the final strike');
    assert.equal(heals.length, dealt.length);
    dealt.forEach((d, i) => close(heals[i], d * Math.min(i + 1, 5) * [0.04, 0.06][f]));
    checkInvariants(h.b);
  });

  test(`陈千语 ${name}: 赤霄共鸣 — a stack for 狙击 allies and a tile of range per kill`, run, async (t) => {
    const { h, checkInvariants, chen, units: [yinxian, yueyue, jingzhe] } = await fight(form, 1, 40);
    const key = `chen-qianyu:resonance:${chen.id}`;
    // her range after `kills`: rows −s…s and columns −s…1+s (s = stacks, at most 8) — her own [0,0],[0,1] grown a tile
    // forward, up, down and back per stack
    const shape = (kills) => {
      const s = Math.min(8, kills), want = [];
      for (let r = -s; r <= s; r++) for (let c = -s; c <= 1 + s; c++) want.push(`${r},${c}`);
      assert.deepEqual(chen.liveRangeGrid.map(([r, c]) => `${r},${c}`).sort(), want.sort(), `range after ${kills} kills`);
    };
    shape(0);

    h.runUntil(() => chen.mem.cqyKills >= 2, 90);
    h.step();
    const kills = chen.mem.cqyKills;
    assert.equal(kills, h.hooksOf('death').filter((e) => e.killer === chen && e.reason === 'killed').length);
    for (const sniper of [yinxian, yueyue]) {
      const buff = sniper.findBuff(key);
      assert.equal(buff.stacks, Math.min(8, kills));
      close(buff.mods.atkPct, [0.5, 0.75][f]);
    }
    assert.ok(!jingzhe.findBuff(key), 'a caster is not a 射手');
    assert.ok(!chen.findBuff(key), 'she does not buff herself');
    assert.equal(chen.s.rangeExtend, Math.min(8, kills));
    shape(kills);

    h.run(120);
    const all = chen.mem.cqyKills;
    t.diagnostic(`${all} kills: ${yinxian.findBuff(key).stacks} stacks, range +${chen.s.rangeExtend}`);
    assert.ok(all > 8, 'enough kills to reach the cap');
    assert.equal(yinxian.findBuff(key).stacks, 8, 'at most 8 stacks');
    assert.equal(chen.s.rangeExtend, 8, 'forward stops at 8 too');
    shape(all);
    checkInvariants(h.b);
  });
}

// 特性: a stack of DEF% and RES per hit she deals, 20 at most, 10 s from her last hit
for (const [form, f] of [['a', 0], ['b', 1]]) {
  test(`陈千语 ${form === 'a' ? 'normal' : 'elite'}: 特性 — DEF and RES for every hit she deals`, run, async () => {
    const { h, checkInvariants, chen } = await fight(form, 8);
    const key = 'chen-qianyu:guard';
    const hits = () => h.hooksOf('damaged').filter((e) => (e.credit ?? e.source) === chen && e.target.side === 'enemy' && e.amount > 0).length;
    assert.equal(hits(), 0);
    assert.ok(!chen.findBuff(key), 'no stacks before her first hit');
    const def0 = chen.s.def, res0 = chen.s.res;

    h.runUntil(() => hits() >= 3, 60);
    const n = hits(), buff = chen.findBuff(key);
    assert.equal(buff.stacks, Math.min(20, n));
    close(chen.s.def, def0 * (1 + buff.stacks * [0.03, 0.05][f]));
    close(chen.s.res, Math.min(100, res0 + buff.stacks * [2, 3][f]));

    h.runUntil(() => hits() >= 25, 60);
    assert.equal(chen.findBuff(key).stacks, 20, 'at most 20 stacks');
    close(chen.s.res, Math.min(100, res0 + 20 * [2, 3][f]));
    checkInvariants(h.b);
  });
}
