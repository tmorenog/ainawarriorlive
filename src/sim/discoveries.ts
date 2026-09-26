// Tracks landmarks and hidden places the player has found.
import type { Game } from '../game';

export class Discoveries {
  constructor(private game: Game) {}

  has(key: string) { return this.game.mods.discovered.includes(key); }

  check(x: number, z: number) {
    const game = this.game;
    for (const l of game.territories.landmarksNear(x, z, 6)) {
      if (l.kind === 'borderStone') continue;
      const key = 'lm:' + l.id;
      if (this.has(key)) continue;
      this.add(key, `Discovered ${l.name}.`);
      game.objectives.onDiscover(l.id);
    }
    for (const s of game.chunks.structuresNear(x, z, 5)) {
      const key = `st:${Math.round(s.x)},${Math.round(s.z)}`;
      if (this.has(key)) continue;
      this.add(key, `Found ${s.name}${s.type === 'cave' ? ' — dark and echoing' : s.type === 'clearing' ? ' — sunlight pools among the flowers' : ''}.`);
    }
    const biome = game.chunks.biomeAt(x, z);
    const bkey = 'biome:' + biome;
    if (!this.has(bkey)) this.add(bkey, `First time exploring the ${biome === 'farmland' ? 'Tallfolk fields' : biome}.`, false);
  }

  add(key: string, text: string, toast = true) {
    const game = this.game;
    game.mods.discovered.push(key);
    game.clan.log(text, 'discovery');
    const c = game.clan.player;
    if (c) c.skills.knowledge = Math.min(99, c.skills.knowledge + 1.5);
    if (toast) game.ui.toast(text, 'discovery');
  }

  count() { return this.game.mods.discovered.length; }
}
