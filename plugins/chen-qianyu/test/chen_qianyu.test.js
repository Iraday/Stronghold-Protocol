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
  // 陈千语, 惊蛰, 莫斯提马 (elite), 能天使, 塑心, 夕, 赫默, 古米 — and 拉普兰德, a member until 1.0.15
  const ids = ['chess_x_chen_qianyu_chen_a', 'chess_char_1_03_a', 'chess_char_4_02_b', 'chess_char_3_01_a',
    'chess_char_6_09_a', 'chess_char_5_12_a', 'chess_char_2_02_a', 'chess_char_1_10_a', 'chess_char_2_16_a'];
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
    assert.deepEqual(on.map((v, i) => v.aspd - off[i].aspd), [...Array(members).fill(aspd), 0], `tier ${tier}: members +${aspd} ASPD, 拉普兰德 (not a member) +0`);
    assert.deepEqual(on.map((v, i) => v.def - off[i].def), [...Array(members).fill(def), 0], `tier ${tier}: members +${def} DEF, 拉普兰德 +0`);
  }
});

test('【钢板】 active layers give every member +20 DEF each and follow in-battle gains', run, async () => {
  const { makeBattle, checkInvariants } = await import('../../../test/helpers/battleHarness.js');
  const { getData } = await import('../../../server/data.js');
  const { installServerOperatorTraits } = await import('../../../server/plugins/operatorTraits.js');
  await installServerOperatorTraits(getData());
  const BID = 'bond_x_chen_qianyu_gangban';
  const ids = ['chess_x_chen_qianyu_chen_a', 'chess_char_3_01_a', 'chess_char_3_03_a']; // 陈千语, 能天使, 诗怀雅 (not a member)
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

  test(`陈千语 ${name}: Blade Gale (the elite 5× the normal) and 斩锋`, run, async () => {
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
    // 斩锋: a stack per skill hit — the 6 slashes reach the 5, so the final strike has their ATK
    assert.equal(chen.findBuff('chen-qianyu:edge').stacks, 5);
    const atkStacked = chen.s.atk;
    close(atkStacked / atk, 1 + 5 * [0.04, 0.08][f]);
    // 6 slashes and the final strike, × ATK before DEF: the first slash without a stack, the final strike with 5
    const skillHits = h.hooksOf('hit').slice(before.hit).filter((e) => e.credit === chen && e.dmg.isSkill).map((e) => e.dmg.amount);
    close(Math.min(...skillHits) / atk, [0.6, 3.0][f]);
    close(Math.max(...skillHits) / atkStacked, [3.0, 15.0][f]);
    // 斩锋 heal: the n-th skill hit heals her min(n, 5) × 4% (elite 6%) of the damage it dealt
    const dealt = h.hooksOf('damaged').slice(before.damaged)
      .filter((e) => (e.credit ?? e.source) === chen && e.dmg?.isSkill && e.target.side === 'enemy' && e.amount > 0).map((e) => e.amount);
    const heals = h.hooksOf('heal').slice(before.heal).filter((e) => e.source === chen && e.target === chen).map((e) => e.amount);
    assert.equal(dealt.length, 7, 'the 6 slashes and the final strike');
    assert.equal(heals.length, dealt.length);
    dealt.forEach((d, i) => close(heals[i], d * Math.min(i + 1, 5) * [0.04, 0.06][f]));
    checkInvariants(h.b);
  });

  test(`陈千语 ${name}: 当弃即弃 — a stack for 狙击 allies and a tile of range per kill`, run, async (t) => {
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

    // her kills are read every 0.5 s (sim/index.js POLL): wait for a look that has them all
    h.runUntil(() => chen.mem.cqyKills >= 2 && chen.mem.cqyKills === chen.stats.kills, 90);
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

    // her normal attacks are counted every 0.5 s (sim/index.js POLL), two hits each: a look catches up with every hit
    h.runUntil(() => hits() >= 3, 60);
    h.runUntil(() => chen.findBuff(key)?.stacks === Math.min(20, hits()), 2);
    const n = hits(), buff = chen.findBuff(key);
    assert.equal(buff.stacks, Math.min(20, n));
    close(chen.s.def, def0 * (1 + buff.stacks * [0.03, 0.05][f]));
    close(chen.s.res, Math.min(100, res0 + buff.stacks * [2, 3][f]));

    h.runUntil(() => hits() >= 25, 60);
    h.run(0.6);
    assert.equal(chen.findBuff(key).stacks, 20, 'at most 20 stacks');
    close(chen.s.res, Math.min(100, res0 + 20 * [2, 3][f]));
    checkInvariants(h.b);
  });
}

// 【钢板】's members (the owner's list of 2026-10-24): 陈千语 and 17 official operators, every shop piece of each — 华法琳's
// and 妮芙's second (hidden) pieces too — each with the 钢板 驻守 trait; the six removed in 1.0.15 are no members
test('【钢板】 members: 陈千语 and the 17 official operators, without the 6 removed ones', run, async () => {
  const { getData } = await import('../../../server/data.js');
  const data = getData();
  const BID = 'bond_x_chen_qianyu_gangban';
  const members = { 陈千语: 'char_x_chen_qianyu_chen', 能天使: 'char_103_angel', 新约能天使: 'char_1041_angel2', 蕾缪安: 'char_4193_lemuen',
    莫斯提马: 'char_213_mostma', 小满: 'char_4122_grabds', 塑心: 'char_245_cello', 赫默: 'char_108_silent', 夕: 'char_2015_dusk',
    华法琳: 'char_171_bldsk', 泡泡: 'char_381_bubble', 铃兰: 'char_358_lisa', 古米: 'char_196_sunbr', 佩佩: 'char_4058_pepe',
    妮芙: 'char_4146_nymph', 蒂比: 'char_4191_tippi', 忍冬: 'char_4026_vulpis', 惊蛰: 'char_306_leizi' };
  const removed = { 琳琅诗怀雅: 'char_1033_swire2', 诗怀雅: 'char_308_swire', 缪尔赛思: 'char_249_mlyss', 纯烬艾雅法拉: 'char_1016_agoat2',
    德克萨斯: 'char_102_texas', 拉普兰德: 'char_140_whitew' };
  const chess = Object.values(data.chess);
  const gangban = (c) => (c.garrisonIds ?? []).some((id) => data.garrisons[id]?.desc?.startsWith('【钢板】'));
  for (const [name, charId] of Object.entries(members)) {
    const pieces = chess.filter((c) => c.charId === charId);
    assert.ok(pieces.length >= 2, `${name}: shop pieces`);
    for (const c of pieces) {
      assert.ok(c.bonds.includes(BID), `${name} ${c.chessId}: in 【钢板】`);
      assert.ok(gangban(c), `${name} ${c.chessId}: the 钢板 驻守 trait`);
    }
  }
  for (const [name, charId] of Object.entries(removed)) {
    for (const c of chess.filter((x) => x.charId === charId)) {
      assert.ok(!c.bonds.includes(BID) && !gangban(c), `${name} ${c.chessId}: no longer in 【钢板】`);
    }
  }
  assert.equal(new Set(chess.filter((c) => c.bonds.includes(BID)).map((c) => c.charId)).size, 18, '18 members');
});

// the plugin's 8000 actions per battle (server/sim/content/dsl/budget.js): a busy 5-minute battle — 9 operators, 300
// enemies — leaves her every effect. 1.0.13's battle-wide damage hooks spent them all after ~2 minutes.
test('陈千语 keeps her effects through a long, busy battle (the action budget)', run, async (t) => {
  const { makeBattle, checkInvariants } = await import('../../../test/helpers/battleHarness.js');
  const { budgetUsed, budgetDisabled } = await import('../../../server/sim/content/dsl/budget.js');
  const { getData } = await import('../../../server/data.js');
  const { installServerOperatorTraits } = await import('../../../server/plugins/operatorTraits.js');
  await installServerOperatorTraits(getData());
  const ids = ['chess_x_chen_qianyu_chen_b', 'chess_char_1_01_b', 'chess_char_1_09_b', 'chess_char_3_01_b', 'chess_char_1_03_b',
    'chess_char_3_03_b', 'chess_char_4_02_b', 'chess_char_1_08_b', 'chess_char_2_16_b'];
  const at = [[9, 5], [10, 4], [11, 4], [10, 3], [9, 3], [9, 6], [10, 6], [9, 7], [10, 7]];
  const h = makeBattle({ seed: 7, timeLimit: 400, units: ids.map((chessId, i) => ({ chessId, row: at[i][0], col: at[i][1] })),
    bonds: { bond_x_chen_qianyu_gangban: { count: 8, active: true, tier: 4, layers: 30 } },
    enemies: [{ key: 'enemy_1422_lrsldr', time: 0, route: 0, count: 300, interval: 1, mods: { hpMul: 40 } }] });
  const chen = h.unit(ids[0]);
  h.run(300);
  h.runUntil(() => chen.mem.cqyKills === chen.stats.kills, 2); // her next look (every 0.5 s) has the latest kill
  const used = budgetUsed(h.b, 'chen-qianyu');
  t.diagnostic(`${used} of 8000 after 300 s; ${chen.stats.attacks} attacks, ${chen.stats.kills} kills`);
  assert.equal(budgetDisabled(h.b, 'chen-qianyu'), false, 'the budget lasts');
  assert.ok(used < 4000, `${used} used in 300 s`);
  const stacks = Math.min(8, chen.stats.kills);
  assert.ok(chen.alive && stacks > 0, 'she fought the whole battle');
  assert.ok(chen.findBuff('chen-qianyu:guard')?.stacks > 0, '特性 stacks still there');
  assert.equal(chen.findBuff('chen-qianyu:reach')?.stacks, stacks, '当弃即弃 range still there');
  assert.equal(h.unit(ids[1]).findBuff(`chen-qianyu:resonance:${chen.id}`)?.stacks, stacks, 'the sniper keeps 当弃即弃');
  assert.ok(chen.findBuff('chen-qianyu:gangban:layers'), '【钢板】 layer DEF still there');
  checkInvariants(h.b);
});

// texts: each tab (普通 / 精锐) reads its own numbers, never 「（精锐…）」; 【钢板】 stays the 驻守 text and its bond popup
// shows the live layer DEF (当前效果)
test('陈千语 texts follow the 普通 / 精锐 tab; 【钢板】 shows its live layer DEF', run, async () => {
  const { getData } = await import('../../../server/data.js');
  const { formatBondEffect } = await import('../../../public/js/ui/richText.js');
  const data = getData();
  const forms = { a: ['60%', '300%', '晕眩1秒', 25, '防御力+3%、法术抗性+2', '+4%', '+50%'],
    b: ['300%', '1500%', '晕眩1.5秒', 22, '防御力+5%、法术抗性+3', '+8%', '+75%'] };
  for (const [form, [slash, fin, stun, sp, guard, edge, per]] of Object.entries(forms)) {
    const c = data.chess[`chess_x_chen_qianyu_chen_${form}`];
    const skill = c.skills?.[0] ?? c.skill;
    const all = [c.trait.desc, skill.desc, ...c.talents.map((t) => t.desc)].join('\n');
    assert.ok(!all.includes('精锐'), `${form}: no 「（精锐…）」 left: ${all}`);
    assert.ok(skill.desc.includes(`攻击力${slash}的物理伤害，随后终结一击造成攻击力${fin}的物理伤害并使目标${stun}`), skill.desc);
    assert.equal(skill.spCost, sp);
    assert.ok(c.trait.desc.startsWith(`普通攻击连续造成两次伤害；每次造成伤害时，${guard}`), c.trait.desc);
    assert.deepEqual(c.talents.map((t) => t.name), ['斩锋', '当弃即弃', '真锋']);
    assert.ok(c.talents[0].desc.includes(`1层斩锋（攻击力${edge}`) && c.talents[1].desc.includes(`每层攻击力${per}`));
    assert.equal(c.talents[2].desc, '在场6名以上不同【钢板】干员时，陈千语造成的所有伤害变为真实伤害');
    const garrisons = (c.garrisonIds ?? []).map((id) => data.garrisons[id].desc);
    assert.deepEqual(garrisons.filter((d) => d.startsWith('【钢板】')).length, 1, `${form}: the 钢板 驻守 text`);
  }
  const bond = data.bonds.bond_x_chen_qianyu_gangban;
  // the numbers in the official bonds' blue (<@ba.vup>); each tier's DEF counts the layers' (the sim: tier buff + 20 × layers)
  const now = (layers) => formatBondEffect(bond, layers).split('\n');
  assert.equal(now(0)[0], '【钢板】干员每层防御力<@ba.vup>+20</>，当前共<@ba.vup>+0</><@ba.acrem>（受层数影响）</>');
  const three = now(3);
  assert.ok(three[0].includes('当前共<@ba.vup>+60</>'), three[0]);
  assert.deepEqual(three.slice(1).map((l) => l.match(/防御力<@ba\.vup>\+(\d+)<\/>$/)?.[1]), ['260', '460', '660', '1860']);
  assert.equal(three[1], '<在场<@ba.vup>2</>名不同【钢板】干员>攻击速度<@ba.vup>+20</>，防御力<@ba.vup>+260</>');
  assert.ok(bond.descRaw.includes('防御力<@ba.vup>+1800</>'));
});

// the strategy 陈千语 (data/band.json): Pith's record with her chess as the round-1 grant and 20 LP
test('strategy 陈千语: 20 LP, in the draft of every mode, 陈千语 in round 1', run, async () => {
  const { getData } = await import('../../../server/data.js');
  const { GameData } = await import('../../../server/match/gamedata.js');
  const { bandMetaHandler } = await import('../../../server/sim/content/bands/meta.js');
  const ID = 'band_x_chen_qianyu_chen';
  const data = getData();
  const band = data.bands[ID];
  assert.equal(band.name, '陈千语');
  assert.equal(band.effectName, '当当');
  assert.equal(band.effectRef, 'band_pith');
  for (const mode of ['mode_single_normal', 'mode_multi_hard']) {
    const gd = new GameData(data, mode);
    assert.ok(gd.bandIds().includes(ID), `${mode}: in the strategy draft`);
    assert.equal(gd.startLp(ID), 20, `${mode}: 20 LP`);
  }
  const granted = [];
  const handler = bandMetaHandler(ID);
  for (const round of [1, 2, 3]) {
    handler.onRoundStart({ round, gd: { item: () => null, chess: (id) => data.chess[id] }, grantChess: (id, o) => granted.push([round, id, o.source]) });
  }
  assert.deepEqual(granted, [[1, 'chess_x_chen_qianyu_chen_a', 'band']], 'her normal chess, once, in round 1');
});

// 当当: the player's active bonds at combat start (阿米娅's count), 6 or more ⇒ every operator defIgnorePct / resIgnorePct 0.8
test('strategy 陈千语 当当: 6 active bonds ⇒ every operator ignores 80% of DEF and RES', run, async () => {
  const { makeBattle, checkInvariants } = await import('../../../test/helpers/battleHarness.js');
  const { getData } = await import('../../../server/data.js');
  // 6 official bonds none of these units is in (精准 left out: its own 3-member pierce is not this test's)
  const bondIds = Object.keys(getData().bonds).filter((id) => !/^(preciShip|bond_x_)/.test(id)).slice(0, 6);
  const ids = ['chess_x_chen_qianyu_chen_a', 'chess_char_1_01_a', 'chess_char_1_03_a']; // 陈千语, 隐现, 惊蛰
  const pierce = (bandId, active) => {
    const h = makeBattle({
      seed: 7, timeLimit: 30, bandId,
      units: ids.map((chessId, i) => ({ chessId, row: 9, col: 3 + i })),
      bonds: Object.fromEntries(bondIds.map((id, i) => [id, { count: 2, active: i < active, tier: i < active ? 1 : 0, layers: 0 }])),
    });
    h.step();
    checkInvariants(h.b);
    return ids.map((id) => [h.unit(id).s.defIgnorePct, h.unit(id).s.resIgnorePct]);
  };
  assert.deepEqual(pierce('band_x_chen_qianyu_chen', 6), ids.map(() => [0.8, 0.8]), '6 active bonds');
  assert.deepEqual(pierce('band_x_chen_qianyu_chen', 5), ids.map(() => [0, 0]), '5 active bonds');
  assert.deepEqual(pierce('band_pith', 6), ids.map(() => [0, 0]), 'another strategy');
});

// 真锋: 【钢板】's count (the battle's bond snapshot) at 6 or more ⇒ her normal attacks and every skill hit are true damage
test('陈千语 真锋: with 6 【钢板】 members on the field all her damage is true damage', run, async () => {
  const { makeBattle, checkInvariants } = await import('../../../test/helpers/battleHarness.js');
  const BID = 'bond_x_chen_qianyu_gangban';
  const types = (count) => {
    const h = makeBattle({
      seed: 7, timeLimit: 60,
      units: [{ chessId: 'chess_x_chen_qianyu_chen_b', row: 9, col: 5 }],
      bonds: { [BID]: { count, active: true, tier: count >= 6 ? 3 : 2, layers: 0 } },
      enemies: [{ key: 'enemy_1422_lrsldr', time: 0, route: 0, count: 6, interval: 1.2, mods: { hpMul: 30 } }],
      hooks: ['damaged', 'skillStart'],
      captureNoisy: true,
    });
    h.step();
    const chen = h.unit('chess_x_chen_qianyu_chen_b');
    h.runUntil(() => h.hooksOf('skillStart').some((e) => e.unit === chen), 60);
    h.run(3);
    checkInvariants(h.b);
    const mine = h.hooksOf('damaged').filter((e) => (e.credit ?? e.source) === chen && e.target.side === 'enemy' && e.amount > 0);
    const kinds = (list) => [...new Set(list.map((e) => e.type))];
    return { normal: kinds(mine.filter((e) => !e.dmg?.isSkill)), skill: kinds(mine.filter((e) => e.dmg?.isSkill)), skillHits: mine.filter((e) => e.dmg?.isSkill).length };
  };
  const on = types(6), off = types(5);
  assert.deepEqual({ normal: on.normal, skill: on.skill }, { normal: ['true'], skill: ['true'] }, '6 members');
  assert.ok(on.skillHits >= 7, 'the 6 slashes and the final strike');
  assert.deepEqual({ normal: off.normal, skill: off.skill }, { normal: ['phys'], skill: ['phys'] }, '5 members');
});
