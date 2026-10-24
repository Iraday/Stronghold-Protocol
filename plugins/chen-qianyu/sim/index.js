// 陈千语 (Arknights: Endfield, endfield.wiki.gg/wiki/Chen_Qianyu) as a 剑豪 guard. Her Endfield ultimate Blade Gale
// (7-sequence slash, the final slash much stronger, Stagger) is the skill; Slashing Edge (ATK +4% / +8% for 10 s per
// skill hit, 5 stacks) is talent 1; this plugin adds that each skill hit heals her a share of its damage that grows
// with the stacks. Endfield's multipliers suit an action game that casts every few seconds, so the numbers below are
// scaled for this mode [ASSUMED]; the elite's skill hits 5× the normal's. Talent 2 赤霄共鸣 is this plugin's own: every
// enemy she kills gives allied 狙击 (射手) operators a stack of ATK, and each stack (at most 8) widens her own attack
// range a tile forward, up, down and back. (The 5×, the kill stacks, the range and the 锋刃 heal: the owner's choices of
// 2026-10-24.)
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
const EDGE = [0.04, 0.08];         // 锋刃 ATK per stack
const EDGE_HEAL = [0.04, 0.06];    // 锋刃 heal per stack, a share of each skill hit's damage: 5 stacks = 20% / 30%
const PER_STACK = [0.5, 0.75];     // 赤霄共鸣 ATK per stack: 8 stacks = +400% / +600%
const MAX_STACKS = 8;              // 赤霄共鸣: a stack per enemy she kills, at most this many
const GUARD_DEF = [0.03, 0.05];    // 特性: DEF per stack, a stack per hit she deals: 20 stacks = +60% / +100%
const GUARD_RES = [2, 3];          // 特性: RES per stack: 20 stacks = +40 / +60 (the engine caps RES at 100)
const GUARD_MAX = 20;
const GUARD_SECONDS = 10;          // each hit restarts the timer of all her stacks
const BOND_ID = 'bond_x_chen_qianyu_gangban';
const LAYER_KEY = 'chen-qianyu:gangban:layers';
const LAYER_DEF = 20;              // 【钢板】: DEF per layer of the bond, while it is active

export default function setup(sp) {
  // 【钢板】 layers (the owner's choice of 2026-10-24): while the bond is active, every member of the player — on the field
  // or not yet — has DEF + LAYER_DEF × the bond's layers, re-read a tick after each in-battle gain (the gain is recorded
  // after the `layerGain` hook)
  sp.content.register({
    install(battle) {
      const bondsOf = (u) => (u.def && (Array.isArray(u.def.bonds) ? u.def.bonds : u.def.raw && u.def.raw.bonds)) || [];
      for (const p of battle.players) {
        const pid = p.playerId;
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
    return {
      skill: {
        kind: 'instant',
        spCost: f ? 22 : 25,
        initSp: 10,
        attack: {
          dmgType: 'phys',
          atkScale: SLASH[f],
          hits: 6,
          onHit(ctx) {
            const { battle, unit, target } = ctx;
            if (target && target.alive) {
              battle.dealDamage(unit, target, { type: 'phys', amount: unit.s.atk * FINAL[f], isSkill: true });
              if (target.alive) battle.applyStatus(target, 'stun', { duration: STUN[f], source: unit });
            }
          },
        },
      },
      talents: [{
        install(battle, unit) {
          // 锋刃: each hit of Blade Gale (6 slashes, the final strike) adds a stack, then heals her stacks × EDGE_HEAL of
          // the damage that hit dealt
          battle.on('damaged', (ctx) => {
            if ((ctx.credit ?? ctx.source) !== unit || !ctx.dmg || !ctx.dmg.isSkill || !ctx.target || ctx.target.side !== 'enemy' || !(ctx.amount > 0)) return;
            const edge = battle.addBuff(unit, { key: EDGE_KEY, duration: 10, refresh: 'stack', stacks: 1, maxStacks: 5, mods: { atkPct: EDGE[f] }, tags: ['talent'] });
            if (edge) battle.heal(unit, unit, ctx.amount * edge.stacks * EDGE_HEAL[f]);
          }, { owner: unit });
        },
      }, {
        install(battle, unit) {
          const mem = unit.mem;
          mem.cqyKills = 0;
          const own = unit.rangeGrid || [[0, 0]];
          // her range, for the rest of the battle — again after a redeploy: per stack (at most 8) 攻击距离 +1 (a tile
          // forward), a row more above and below and a column more behind: the rectangle around her own grid grown by `s`
          // each way (攻击距离 lengthens every row of it forward)
          const reach = () => {
            if (!(mem.cqyKills > 0) || !kit.up(unit)) return;
            const s = Math.min(MAX_STACKS, mem.cqyKills);
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
          // her 狙击 allies' ATK: a stack per kill, at most 8 (each second too, for a sniper deployed later)
          const resonate = () => {
            const stacks = Math.min(MAX_STACKS, mem.cqyKills);
            if (!stacks || !kit.up(unit)) return;
            for (const a of battle.allyUnits) {
              if (a === unit || a.ownerId !== unit.ownerId || a.kind !== 'op' || !kit.up(a) || a.def.profession !== 'SNIPER') continue;
              battle.addBuff(a, { key: `${RESONANCE_KEY}:${unit.id}`, refresh: 'replace', stacks, maxStacks: MAX_STACKS,
                mods: { atkPct: PER_STACK[f] }, tags: ['talent'] });
            }
          };
          battle.on('death', (ctx) => {
            if (ctx.killer !== unit || ctx.reason !== 'killed' || !ctx.unit || ctx.unit.side !== 'enemy') return;
            mem.cqyKills += 1;
            reach();
            resonate();
          }, { owner: unit });
          battle.on('deploy', (ctx) => { if (ctx.unit === unit) reach(); }, { owner: unit });
          battle.every(1, resonate, { owner: unit });
        },
      }, {
        install(battle, unit) {
          // 特性 (the owner's choice of 2026-10-24): every hit she deals — an attack's, a slash, the final strike — adds
          // a stack of DEF and RES
          battle.on('damaged', (ctx) => {
            if ((ctx.credit ?? ctx.source) !== unit || !ctx.target || ctx.target.side !== 'enemy' || !(ctx.amount > 0)) return;
            battle.addBuff(unit, { key: GUARD_KEY, duration: GUARD_SECONDS, refresh: 'stack', stacks: 1, maxStacks: GUARD_MAX,
              mods: { defPct: GUARD_DEF[f], resFlat: GUARD_RES[f] }, tags: ['trait'] });
          }, { owner: unit });
        },
      }],
    };
  });
}
