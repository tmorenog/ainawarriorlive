# Mistwood — A Forest Clan Life

A 3D, first-person cat clan life simulator that runs in the browser. You're born as a kit in a forest clan and grow into an apprentice, a warrior, a mentor, an elder, and maybe the clan's leader. When your cat dies, you keep playing as one of your kits, your apprentice, or another clanmate, and the forest carries on.

Every name, clan, character, place, model, sound and bit of lore is original. All art is procedural geometry and all audio is synthesised at runtime, so the project contains no external assets.

## Clans & naming

On the character screen you choose between two lore modes:

- **Forest Clans (default):** a fan tribute to the *Warriors* novels by Erin Hunter. It has ThunderClan, RiverClan, WindClan and ShadowClan, with book-style names (Firekit → Firepaw → Fireheart → Firestar), StarClan, Twolegs, Fourtrees, Highrock and medicine cats. Familiar cats from the books start in each clan: Bluestar, Tigerclaw, Spottedleaf, Graystripe, Sandstorm, Yellowfang, Ravenpaw, Crookedstar, Leopardfur, Tallstar, Brokenstar and others.
- **Original Mistwood clans:** the game's own names and lore.

*Warriors* names and characters belong to their owners. This mode is an unofficial, non-commercial tribute. If you publish the game, consider making the original mode the default.

## Talking to cats in your own words

Every conversation has a **"Say something…"** box. Type anything and the cat answers in character. Their personality, rank and feelings toward you shape the reply, and your words change the relationship: compliments and apologies help, insults hurt.

- **Built in (default, offline):** a reply engine that understands greetings, hunting, herbs, deathberries, clans, leaders, family, gossip, fighting, StarClan, jokes and more.
- **Smarter AI replies (optional):** deploy to Vercel and add an `ANTHROPIC_API_KEY` environment variable in the project settings. The `api/chat.ts` function then lets cats reply using Claude. If the key is missing or a request fails, the game falls back to the built-in engine. You can switch between the two under **Settings → Cat replies**.

## Running it

```bash
npm install
npm run dev        # local dev server
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

### Deploy to Vercel
The repo includes a `vercel.json` (Vite framework, `npm run build`, output `dist`). Import the repository in Vercel, or run `npx vercel`. No environment variables are needed.

## Controls

| Action | Keyboard / mouse | Touch |
|---|---|---|
| Move / sprint / walk | WASD · Shift · Alt | Left joystick · 💨 |
| Look | Mouse (click to capture) | Drag right side |
| Interact / talk | E | ✋ |
| Crouch (stalk) | C toggle / hold Ctrl | ⬇ |
| Jump · Pounce | Space · crouch + hold Space, release | ⤴ |
| Swipe · heavy pounce attack | Left click / F · Right click / R | 🐾 |
| Dodge (in combat) | Space + direction | ⤴ |
| Sniff / track | Q | 👃 |
| Eat carried prey | G | 🍖 |
| Drop what you carry (on the pile if you're next to it) | B | ⤵ |
| First / third person | V | 👁 |
| Journal · Map · Council | J · M · L | 📖 · 🗺 |
| Pause menu | Esc / P | ☰ |
| Dialogue choices | 1–9 | tap |

## What's in the game

- **Endless procedural world.** The terrain is streamed in 64 m chunks from a deterministic seed, and distant chunks are unloaded. Biomes include dense and pine forest, meadows, marsh, hills, snow-capped mountains, rocky ground and Tallfolk farmland. The world also has rivers, streams, lakes, ponds, roads, houses with lit windows, abandoned barns, caves, hidden clearings and named landmarks. Your own clan and three rival clans each hold territory, and neutral wilds stretch beyond.
- **The clan camp.** A bramble-walled hollow with the High Rock, the leader's den, warriors', apprentices', elders' and medicine dens, the nursery, and a fresh-kill pile that shows how much food the clan has.
- **NPC cats.** Every cat has its own appearance, two personality traits plus a set of personality values, skills, health, hunger, injuries, sickness, family, mentor and apprentice, rank, reputation, relationships and memories. Cats sleep, eat, hunt, patrol, train, fetch herbs and moss, look after kits, guard the entrance and tell stories. They also talk to each other, and you'll overhear them making friends, arguing, gossiping (sometimes about you) and courting.
- **Modular cat models.** Eleven fur patterns are painted into procedural textures. Fur colour, white markings, eye colour, fur length, body type, ear shape, tail shape and size all vary. Kits inherit their looks and traits from both parents, with occasional mutations. Cats grow visibly with age.
- **Life stages.** Kit → apprentice (a ceremony where a mentor is assigned) → warrior (a ceremony where you choose your warrior name) → elder. Aging changes your size, speed, strength and duties.
- **Playable training.** Hunting, tracking, spar fighting, exploring to a landmark, border marking, and a quiz on the clan code. Once you've trained enough you take a warrior assessment. As a mentor you teach your own apprentice the same lessons.
- **Hunting.** Each prey animal has its own senses: hearing, sight, and smell that depends on which way the wind blows. Each also escapes differently: mice dart, rabbits zig-zag, birds fly off, squirrels climb trees, fish dive, frogs hop. Crouch, stalk and time your pounce, then carry the catch back to the pile.
- **Deathberries.** Glossy red bushes grow in the forest and are deadly poisonous. Eating them poisons you until a medicine cat makes you retch them up. Sometimes a kit eats them and you have to rush herbs to the medicine den.
- **Combat.** Stylised and non-graphic, against foxes, badgers, dogs, and rival or exiled cats. The outcome depends on health, strength, fighting skill, which side you attack from, attack wind-ups, dodges and luck. Nearby clanmates come to help. Fights are forgiving, and you can press **X** or the 🏳 button to give up and back away. Losing a fight usually means an injury, and only rarely death.
- **Clan code and consequences.** Rules cover leaving camp as a kit, crossing borders, eating before the clan is fed, disobeying orders, helping outsiders, going near Tallfolk dens, and breaking confinement. Only witnesses (or scent found later) catch you. Punishments escalate: a warning, extra duties, confinement to camp, loss of rank, and eventually exile. Exiles can survive alone and later ask to come home.
- **Relationships and family.** Cats can be strangers, acquaintances, friends, close friends, rivals, enemies, family or mates. You can groom, share prey, tease, play-fight, court a mate and raise kits, or foster orphans.
- **Politics.** The leader (the "Warden") appoints a Second (the deputy). When the Warden dies or retires, the Second takes over. A Warden who loses the clan's support can be forced to step down. As Warden or Second you organise patrols, choose mentors, name your Second, judge rule-breakers, decide whether loners may join, exile cats, respond to fires, floods, droughts, illness and border raids, and deal with the rival clans. Clan cats react to your choices according to their personalities.
- **Events.** Random events are chosen by weighted, condition-aware rolls, so they never come in a fixed order. They include forest fires that leave lasting burn scars and later regrow, floods that raise the water and strand cats who need rescuing, droughts that shrink the streams, storms and fallen trees, cold snaps, rockslides, badger raids, foxes, dogs, prey shortages, illness outbreaks, loners asking to join, abandoned kits, clanmates breaking the code, border skirmishes, and a peaceful Gathering of all the clans every few moons.
- **Generations.** Cats die of old age, illness, wounds, animal attacks, disasters or starvation. When you die, a memorial screen appears and you pick who continues your family's story. In long automated test runs the clan's population and food stayed stable over 200 in-game moons.
- **Weather and time.** A day/night cycle with sunsets, stars, a moon and clouds, and four seasons that change leaf colours. Weather can be sunny, cloudy, rain, heavy rain, thunderstorms with lightning, fog, strong wind or snow. It affects visibility, sound, how prey senses you, what NPCs do, water levels, temperature and which events happen. Fireflies come out at night and leaves fall in autumn.
- **Audio.** All sound is synthesised with WebAudio: wind, rustling leaves, rain, rivers and floodwater, birdsong, crickets, cicadas, owls, frogs, distant animals, thunder, fire crackle, footsteps that change with the surface, and meows, purrs, hisses and growls. Sound is muffled in snow, echoes in caves, and changes when you're underwater.
- **UI.** A minimal HUD showing health, hunger, stamina, what you're carrying, time and weather, a compass with markers, your current objective and interaction prompts. NPCs get speech bubbles and nameplates. There's also a journal (duties, clan history, memories, relationships, clan roster, the code, discoveries), a territory map, the leader's council panel, settings, and autosave.

## Code structure

```
src/
  core/      seeded RNG, simplex noise, math, event bus, game time
  world/     terrain, territories & landmarks, chunk streaming, camp, sky & lighting,
             weather, ambient particles, fire, shared stylised assets
  cats/      cat data model, procedural generation & genetics, modular 3D model
  ai/        NPC embodiment and autonomous behaviour (schedules, jobs, patrols, conversations)
  sim/       clan simulation (aging, births, deaths, politics, code), social & dialogue,
             events, objectives, training, leadership decisions, interactions, discoveries
  player/    first-person controller, input (keyboard/mouse/touch), combat, scent tracking
  wildlife/  prey and predators with models and behaviours
  audio/     procedural sound engine
  ui/        HUD, dialogs, journal/map/council panels, menus, touch controls, styles
  save/      localStorage persistence
  game.ts    orchestrator & main loop
```

Everything in the world is a pure function of the seed plus a small list of persistent changes (burn scars, fallen trees, rockslides, picked herbs, discoveries). That keeps saves small and makes it easy to add new biomes, structures and event types.

## Notes

- Graphics quality (Low / Medium / High) controls view distance, grass density, level-of-detail, shadows and pixel ratio. On weaker devices, use Low.
- Progress is saved in the browser (`localStorage`). It autosaves every 90 seconds, when you sleep, and when you leave the page.
