// 陈千语 (Arknights: Endfield, endfield.wiki.gg/wiki/Chen_Qianyu) as a 剑豪 guard. Her Endfield ultimate Blade Gale
// (7-sequence slash, the final slash much stronger, Stagger) is the skill; Slashing Edge (ATK +4% / +8% for 10 s per
// skill hit, 5 stacks) is talent 1; this plugin adds that each skill hit heals her a share of its damage that grows
// with the stacks. Endfield's multipliers suit an action game that casts every few seconds, so the numbers below are
// scaled for this mode [ASSUMED]; the elite's skill hits 5× the normal's. Talent 2 当弃即弃 is this plugin's own: every
// enemy she kills gives allied 狙击 (射手) operators a stack of ATK, and each stack (at most 8) widens her own attack
// range a tile forward, up, down and back. (The 5×, the kill stacks, the range and the 斩锋 heal: the owner's choices of
// 2026-10-24.)
// Budget: every call of a hook or timer of this plugin and every action it takes count against its 8000 per battle
// (server/sim/content/dsl/budget.js; past them the game strips all its buffs for the rest of that battle). A
// battle-wide `damaged` hook pays for every hit on the board — 2 a hit for the two of 1.0.13, spent after ~2 minutes of
// a busy battle — so the kit hooks no battle-wide event: the skill's own callback does 斩锋, and one timer reads her own
// counters (attacks, damage, kills, redeploys) every POLL seconds for the 特性 and 当弃即弃.
// Talent 3 真锋 (the owner's choice of 2026-10-25): with 6 or more 【钢板】 members on the field (the bond's count, a
// snapshot of the battle) all the damage she deals is true damage — her attack type is switched once at install, so it
// costs nothing per hit. The strategy 陈千语 (data/band.json, Pith's round-1 grant with her chess, 20 LP) adds 当当:
// with 6 or more active bonds every operator of its player ignores 80% of DEF and RES (阿米娅's count of active bonds at
// combat start, 精准's defIgnorePct / resIgnorePct).
import { kit } from 'sp:sdk@1';

const ID = 'char_x_chen_qianyu_chen';
const EDGE_KEY = 'chen-qianyu:edge';
const RESONANCE_KEY = 'chen-qianyu:resonance';
const REACH_KEY = 'chen-qianyu:reach';
const GUARD_KEY = 'chen-qianyu:guard';

// [normal, elite]
const SLASH = [0.6, 3.0];          // ATK scale of each of the 6 slashes
const FINAL = [3.0, 15.0];         // ATK scale of the final strike
const STUN = [1, 1.5];             // seconds of 晕眩 from the final strike (Endfield's Stagger)
const EDGE = [0.04, 0.08];         // 斩锋 ATK per stack
const EDGE_HEAL = [0.04, 0.06];    // 斩锋 heal per stack, a share of each skill hit's damage: 5 stacks = 20% / 30%
const EDGE_MAX = 5;
const PER_STACK = [0.5, 0.75];     // 当弃即弃 ATK per stack: 8 stacks = +400% / +600%
const MAX_STACKS = 8;              // 当弃即弃: a stack per enemy she kills, at most this many
const GUARD_DEF = [0.03, 0.05];    // 特性: DEF per stack, a stack per hit she deals: 20 stacks = +60% / +100%
const GUARD_RES = [2, 3];          // 特性: RES per stack: 20 stacks = +40 / +60 (the engine caps RES at 100)
const GUARD_MAX = 20;
const GUARD_SECONDS = 10;          // each hit restarts the timer of all her stacks
const NORMAL_HITS = 2;             // 剑豪: a normal attack deals damage twice
const POLL = 0.5;                  // seconds between two looks at her counters: 2 of the budget a second
const BOND_ID = 'bond_x_chen_qianyu_gangban';
const LAYER_KEY = 'chen-qianyu:gangban:layers';
const LAYER_DEF = 20;              // 【钢板】: DEF per layer of the bond, while it is active
const TRUE_COUNT = 6;              // 真锋: 【钢板】 members on the field for true damage
const BAND_ID = 'band_x_chen_qianyu_chen';
const BAND_KEY = 'chen-qianyu:band';
const BAND_BONDS = 6;              // 当当: active bonds needed
const BAND_PIERCE = 0.8;           // 当当: share of DEF and RES ignored

export default function setup(sp) {
  // 【钢板】 layers (the owner's choice of 2026-10-24): while the bond is active, every member of the player — on the field
  // or not yet — has DEF + LAYER_DEF × the bond's layers, re-read a tick after each in-battle gain (the gain is recorded
  // after the `layerGain` hook)
  sp.content.register({
    install(battle) {
      const bondsOf = (u) => (u.def && (Array.isArray(u.def.bonds) ? u.def.bonds : u.def.raw && u.def.raw.bonds)) || [];
      for (const p of battle.players) {
        const pid = p.playerId;
        // 当当 (the strategy 陈千语): the player's active bonds at combat start
        const active = Object.values(p.bonds || {}).filter((b) => b && b.active).length;
        if (p.bandId === BAND_ID && active >= BAND_BONDS) {
          for (const u of battle.allyUnits) if (u.kind === 'op' && u.ownerId === pid) battle.addBuff(u, { key: BAND_KEY, persist: true, allowDead: true,
            refresh: 'replace', mods: { defIgnorePct: BAND_PIERCE, resIgnorePct: BAND_PIERCE }, tags: ['band'] });
        }
        const members = battle.allyUnits.filter((u) => u.kind === 'op' && u.ownerId === pid && bondsOf(u).includes(BOND_ID));
        if (!members.length) continue;
        const apply = () => {
          const b = p.bonds && p.bonds[BOND_ID];
          const layers = b && b.active ? Math.max(0, Math.floor(b.layers || 0)) : 0;
          if (!layers) return;
          for (const u of members) battle.addBuff(u, { key: LAYER_KEY, persist: true, allowDead: true, refresh: 'replace',
            mods: { defFlat: LAYER_DEF * layers }, tags: ['bond'] });
        };
        apply();
        let pending = false;
        battle.on('layerGain', (c) => {
          if (c.playerId !== pid || c.bondId !== BOND_ID || pending) return;
          pending = true;
          battle.after(0, () => { pending = false; apply(); });
        });
      }
    },
  });

  sp.kits.register(ID, (bb, chess) => {
    const f = chess && chess.isGolden ? 1 : 0;
    // 特性 (the owner's choice of 2026-10-24): `n` more stacks of DEF and RES, and the 10 s of all of them restart (a
    // new buff is not capped at maxStacks: the counts are)
    const guard = (battle, unit, n) => {
      if (n > 0) battle.addBuff(unit, { key: GUARD_KEY, duration: GUARD_SECONDS, refresh: 'stack', stacks: Math.min(n, GUARD_MAX), maxStacks: GUARD_MAX,
        mods: { defPct: GUARD_DEF[f], resFlat: GUARD_RES[f] }, tags: ['trait'] });
    };
    return {
      skill: {
        kind: 'instant',
        spCost: f ? 22 : 25,
        initSp: 10,
        attack: {
          // no dmgType: the attack takes her profile's (physical, or true under 真锋)
          atkScale: SLASH[f],
          hits: 1,
          // the attack is the first slash; the other 5 and the final strike are dealt here, so that 斩锋 stacks and heals
          // per hit: each hit that dealt damage adds a stack and heals her stacks × EDGE_HEAL of it. The slashes keep the
          // ATK the attack started with; the final strike has the slashes' stacks.
          onHit(ctx) {
            const { battle, unit, target } = ctx;
            unit.mem.cqySkillAttacks = (unit.mem.cqySkillAttacks || 0) + 1;
            const atk = unit.s.atk;
            const type = unit.mem.cqyTrue ? 'true' : 'phys';
            const edge = unit.findBuff(EDGE_KEY);
            let stacks = edge ? edge.stacks : 0, landed = 0;
            const struck = (dealt) => {
              if (!(dealt > 0)) return false;
              landed += 1;
              stacks = Math.min(EDGE_MAX, stacks + 1);
              battle.heal(unit, unit, dealt * stacks * EDGE_HEAL[f]);
              return true;
            };
            const stackEdge = (n) => battle.addBuff(unit, { key: EDGE_KEY, duration: 10, refresh: 'stack', stacks: Math.min(n, EDGE_MAX), maxStacks: EDGE_MAX,
              mods: { atkPct: EDGE[f] }, tags: ['talent'] });
            struck(ctx.dealt);
            for (let i = 1; i < 6 && target && target.alive; i++) {
              struck(battle.dealDamage(unit, target, { type, amount: atk * SLASH[f], isSkill: true, isAttack: true }));
            }
            if (landed) stackEdge(landed);
            if (target && target.alive) {
              if (struck(battle.dealDamage(unit, target, { type, amount: unit.s.atk * FINAL[f], isSkill: true }))) stackEdge(1);
              if (target.alive) battle.applyStatus(target, 'stun', { duration: STUN[f], source: unit });
            }
            guard(battle, unit, landed);
          },
        },
      },
      talents: [{
        install(battle, unit) {
          const mem = unit.mem;
          mem.cqyKills = 0;
          mem.cqySkillAttacks = 0;
          const own = unit.rangeGrid || [[0, 0]];
          const seen = { attacks: unit.stats.attacks, skill: 0, dmg: unit.stats.dmg, reach: 0, deployedAt: null };
          // 当弃即弃 range, `s` stacks: 攻击距离 +s (a tile forward each), a row more above and below and a column more behind
          // per stack: the rectangle around her own grid grown by `s` each way (攻击距离 lengthens every row of it forward)
          const reach = (s) => {
            battle.addBuff(unit, { key: REACH_KEY, refresh: 'replace', stacks: s, maxStacks: MAX_STACKS,
              mods: { rangeExtend: 1 }, tags: ['talent'] });
            const rows = own.map(([r]) => r), cols = own.map(([, c]) => c);
            const grid = [];
            for (let r = Math.min(...rows) - s; r <= Math.max(...rows) + s; r++) {
              for (let c = Math.min(...cols) - s; c <= Math.max(...cols); c++) grid.push([r, c]);
            }
            unit.rangeGrid = grid;
            battle.refreshRange(unit);
          };
          // her 狙击 allies' ATK, `s` stacks: written only where it is missing or out of date (a sniper deployed later too)
          const resonate = (s) => {
            const key = `${RESONANCE_KEY}:${unit.id}`;
            for (const a of battle.allyUnits) {
              if (a === unit || a.ownerId !== unit.ownerId || a.kind !== 'op' || !kit.up(a) || a.def.profession !== 'SNIPER') continue;
              const has = a.findBuff(key);
              if (has && has.stacks === s) continue;
              battle.addBuff(a, { key, refresh: 'replace', stacks: s, maxStacks: MAX_STACKS, mods: { atkPct: PER_STACK[f] }, tags: ['talent'] });
            }
          };
          battle.every(POLL, () => {
            if (!kit.up(unit)) return;
            const st = unit.stats;
            // 特性: her normal attacks since the last look (the skill's hits stack in its callback), when they dealt damage
            const normal = st.attacks - seen.attacks - (mem.cqySkillAttacks - seen.skill);
            if (normal > 0 && st.dmg > seen.dmg) guard(battle, unit, normal * NORMAL_HITS);
            seen.attacks = st.attacks; seen.skill = mem.cqySkillAttacks; seen.dmg = st.dmg;
            // 当弃即弃: the enemies she killed (stats.kills: real kills of enemies credited to her), at most 8 stacks; her
            // range again after a redeploy
            mem.cqyKills = st.kills;
            const s = Math.min(MAX_STACKS, st.kills);
            if (!s) return;
            if (s !== seen.reach || unit.deployedAt !== seen.deployedAt) {
              reach(s);
              seen.reach = s; seen.deployedAt = unit.deployedAt;
            }
            resonate(s);
          }, { owner: unit });
        },
      }, {
        // 真锋: 【钢板】's count of her player (the bond snapshot, fixed for the battle) at 6 or more ⇒ her attacks (normal
        // and skill) take the true type, and so do the slashes and the final strike she deals in the skill's callback
        install(battle, unit) {
          const p = battle.players.find((x) => x.playerId === unit.ownerId);
          const b = p && p.bonds && p.bonds[BOND_ID];
          unit.mem.cqyTrue = !!(b && b.count >= TRUE_COUNT);
          if (unit.mem.cqyTrue) unit.profile = { ...unit.profile, dmgType: 'true' };
        },
      }],
    };
  });
}
