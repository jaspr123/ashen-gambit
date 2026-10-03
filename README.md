# Ashen Gambit

Post-apocalyptic multiplayer 3D battle chess. Standard chess rules (chess.js), server-authoritative multiplayer, and **every capture is a short physical fight played on the real board** — no cut-scenes, no separate arena.

```
CHESS + LIVING MINIATURE BATTLEFIELD + ON-BOARD COMBAT + TACTICAL MULTIPLAYER ARENA
+ FOUR FACTIONS + CUSTOM ARMIES + FINISHERS + CUSTOM ATTACK/DEATH ANIMATIONS + LIVE SPECTATOR LOBBY
```

## Quick start

Requirements: Node 20+ (tested on 24), npm 10+. Optional: PostgreSQL 14+, Blender 4.4+ (asset pipeline).

```bash
npm install
npm run dev          # server :3001 + client :5173 (Vite proxies /socket.io, /api, /uploads)
```

Open http://localhost:5173, pick a callsign, and you are in the lobby. Press <kbd>`</kbd> for the dev console (simulated players, bot matches, position loader, combat tests).

| Command | What it does |
|---|---|
| `npm run dev` | server (tsx watch) + client (Vite) |
| `npm test` | shared rules/ability/combat tests + full multiplayer smoke test (real sockets) |
| `npm run typecheck` | all workspaces |
| `npm run build` | production client build (`apps/client/dist`) |
| `npm start` | production server (also serves the built client) |
| `npm run assets:build` | rebuild faction + environment GLBs from your Synty packs with Blender |
| `npm run assets:optimize` | Meshopt + WebP compress every GLB for the web |
| `npm run db:migrate -w @ashen/server` | apply `schema.sql` to `DATABASE_URL` |

Without `DATABASE_URL` the server uses a JSON file store in `apps/server/data/` — zero setup for development. Set `DATABASE_URL=postgres://…` and the same code uses PostgreSQL.

## Repository layout

```
packages/shared/          @ashen/shared — used by BOTH client and server
  src/chess/engine.ts       ChessEngine: chess.js + history, repetition, War Chess AbilitySystem
  src/chess/simpleAi.ts     alpha-beta fallback AI (server bots)
  src/checkers/engine.ts    CheckersEngine: draughts rules, multi-jump chains, crowning, alpha-beta AI
  src/rules.ts              RulesEngine union + createEngine/restoreEngine per game mode
  src/derby/                Wasteland Derby: roster, weapons, upgrades, track, deterministic race sim + odds pricing
  src/combat/timeline.ts    serialisable CombatSequence format (zod-validated)
  src/combat/resolver.ts    CombatRegistry + fallback chain + deterministic death choice
  src/game-data/            factions, pieces, abilities, finishers, deaths, animations,
                            sounds, arenas, gameModes, ai levels, achievements  (data-driven)
  src/customArmy.ts         custom army schema + validator (re-run server-side)
  src/protocol.ts           every client->server message as a zod schema; typed server events
apps/server/              Node + Express + Socket.IO (authoritative)
  src/game/Match.ts         one match: engine, clocks (+capture grace), reconnect grace, draw, rematch, hidden info
  src/game/MatchManager.ts  create/persist/restore/conclude matches, Elo, stats
  src/game/MatchmakingManager.ts  quick queue (simultaneous matches), challenges, private codes
  src/game/ArenaManager.ts  King-of-the-Board tables (champion + challenger queue + countdown)
  src/game/LobbyManager.ts  presence + derived player status, throttled lobby snapshots
  src/game/BotManager.ts    simulated lobby players that queue, spectate and play
  src/game/CustomArmyManager.ts + glbInspect.ts   uploads, server-side GLB measurement, validation
  src/db/                   Repository interface, PostgreSQL + JSON implementations, schema.sql
  src/net/socketServer.ts   auth, schema validation, rate limiting, routing
apps/client/              React + TypeScript + Three.js / React Three Fiber
  src/game/                 imperative 3D runtime (no React re-renders in the hot path)
    BoardStage.ts             board, PieceManager, overlays, picking, slow-mo, stage clock
    CameraDirector.ts         top-down three-quarter tactical camera, limits, combat framing, free cam
    CombatDirector.ts         moves, leaps, castling, captures, checkmate King Defeat sequence
    CombatTimelineManager.ts  executes CombatSequences against two actors on the real board
    DeathAnimationManager.ts  clip or procedural deaths (fall/kneel/knockback/twitch/power-down/disassembly)
    FxSystem.ts               pooled, seeded particles (sparks, dust, smoke, shockwave, debris, fire…)
    pieces/                   ProceduralPieceFactory (fallback art), PieceVisual (procedural +
                              transform fallbacks), SkinnedVisual (GLB clips via AnimationMixer)
    FactionManager.ts         faction/custom-army -> visuals + combat metadata
    AssetManager.ts           GLB loading (Draco/Meshopt), manifest, per-match preloading
    GameController.ts         GameState for online/spectate/local/AI/replay/demo sessions + HUD store
    AiPlayer.ts               Stockfish 17.1 WASM (5 levels) with fallback
    ModelImportManager.ts     GLB/GLTF/FBX/OBJ/ZIP import, auto-fit, measure, thumbnail, GLB export
    AnimationMappingManager.ts clip auto-mapping, skeleton detection, bone-name retargeting
    ArenaEnvironment.ts       ruined city (procedural + Synty set dressing)
  src/core/                 NetworkManager, AudioManager (buses + procedural placeholders), settings, stores
  src/ui/                   Lobby, Loadout (3D preview), HUD, Profile, Settings, Army Creator,
                            Kill Sequence Editor, Combat Laboratory, Dev console
tools/blender/            Blender build scripts (factions, environment) + probes
tools/asset-pipeline/     .unitypackage listing/extraction, GLB optimiser
```

## Architecture

### Authority
The server owns the truth. Clients send *intents* (`match:move {from,to,ply}`), never states. The server validates with the shared `ChessEngine` (illegal, out-of-turn, stale/duplicate `ply`, flagged clock), applies abilities, resolves results, updates ratings and broadcasts per-viewer state. Hidden information (secret abilities, mines) is filtered per viewer **on the server**; spectators never receive hidden data. All payloads are zod-validated and rate-limited (token buckets: general / game / chat).

Clocks are server-side. When a move captures, the next clock gets a *grace period* equal to the resolved fight length (1.5–4.5 s) so animations never cost anyone time. Disconnects start a 60 s reconnect grace; reconnecting with the stored token resumes the same identity and match.

### On-board combat
1. A capture resolves a `CombatSequence` through the **fallback chain** (`shared/combat/resolver.ts`):
   `faction:atk_vs_def:finisher` → `faction:atk:any` (custom army) → `atk_vs_def:finisher` → `atk:finisher` → `rig:<rig>:capture` → `faction_<id>_capture` → `base_capture`.
2. The death type is chosen from the defender's compatible deaths, weighted by attacker class, with a deterministic seed (the ply) so every player, spectator and replay sees the same fight.
3. `CombatTimelinePlayer` runs the timeline against the two real actors using **board anchors** (`strike`, `close`, `flank_left`, `behind_target`, `target`…) computed from the actual squares, so any timeline works for any piece and any model.
4. Actions are canonical (`ATTACK_HEAVY`, `HIT_LIGHT`, `DEATH_HEAVY`…). Skinned models map them to clips; anything unmapped falls back to procedural humanoid / mechanical / whole-object motion. The camera pushes toward the fight but keeps neighbouring squares in frame, then returns.
5. Checkmate triggers the King Defeat sequence on the board: everything else freezes, ambience ducks, camera pushes in, the king reacts, the mating piece performs the winner's **King/Victory finisher**, the king falls, the camera pulls back, the result card appears over the arena. Skippable (<kbd>Space</kbd>).

Timelines are plain JSON data — the same format is used by built-in finishers, the Kill Sequence Editor, replays and the Combat Laboratory.

### War Chess abilities
Defined as data in `game-data/abilities.ts`; behaviour lives in a handful of effect handlers in `ChessEngine`. Each faction has one passive, one limited-use ability and one piece-specific ability (charges/cooldowns):

| Faction | Identity | Passive | Limited | Piece-specific |
|---|---|---|---|---|
| Remnants | information | Dead Man's Intel (track the capturer) | Recon Drone (threat map + reveal) | Smoke Screen (Knight: no-capture cloud) |
| Machines | defense | Interlocked Chassis (pawn chains immune to pawns) | Shield Field | Magnetic Lockdown (Rook line freeze) |
| Wastelanders | aggression | Raider's Momentum (captures refill mines) | Scrap Mine (hidden) | Molotov (Pawn: destroy a pawn, uses turn) |
| Vault | technology | Neural Link (see enemy's next options) | Phase Shift (teleport, uses turn) | EMP Pulse (Bishop: area freeze) |

Rules that keep chess intact: restrictions never apply to a side in check and never remove every legal move (so checkmate/stalemate mean what they always mean); board edits are rejected if they would leave the side-not-to-move in check. Visibility: `OFF / VISIBLE / SECRET` (enemy abilities hidden until revealed in play).

### Battle Checkers
A fourth mode on the same board, armies and combat system. Men are pawns and crowned men are kings; they move diagonally on the dark squares. Captures are mandatory, and a jump is fought out on the jumped square before the attacker lands. Multi-jump chains keep the turn with the same piece: the clock keeps running, and the client pre-selects that piece. Reaching the far rank crowns the man and ends the turn. A side with no pieces or no legal moves loses. The game is drawn by threefold repetition or 80 plies without a capture or a man move. The server validates every jump. Practice games use the built-in alpha-beta checkers AI instead of Stockfish. Checkers positions use a chess-style FEN with `P/K/p/k` and a seventh field for the square that must keep jumping.

### Wasteland Derby
A spectator betting mode, opened from the lobby. Races run continuously on a server cycle: 45 s of betting, the gates, a race of about 40 s, then results. Eight armed jockeys ride the faction knights' horses once round a dirt oval. They attack each other with pipes, chains, sawn-offs, crossbows, flare guns and cattle prods. Players never control a horse. They:

- **Read the card.** Each runner shows stats, weapon, form and fixed **win / place / show** odds. The server prices these by running the race simulation a few hundred times without upgrades.
- **Bet** credits from a persistent bank. Every account starts with 1000 credits and is topped back up to 150 when broke. Odds are locked when the bet is placed.
- **Pay the stable hands in secret.** Once you have backed a horse, you can buy horse upgrades (Nitro Oats, Plated Barding, Iron Lungs, Spiked Shoes) or jockey perks (Scattergun Rounds, Smoke Bombs, Grapple Hook, Field Medic, Trick Rider). Other players only see that "N secret deals" exist. The posted odds never move. Every deal is revealed with the results.

When betting closes, the server simulates the race once. The simulation is deterministic and seeded, and it includes every purchased upgrade. The server ships the replay timeline (positions, health, flags, events) to every watcher. Clients replay it in sync with the server clock, using an auto-director (broadcast, incident, finish-line) or Follow/Aerial cameras. Payouts are settled on the server. Bets live in memory for the length of a race. Bank balances persist in the database (`player_statistics.credits`). `DERBY_FAST=1` shortens the cycle for tests.

### Arcade Chess
Real-time chess with no turns. Either player may move any of their pieces whose cooldown has run out: 2 s for pawns and kings, 2.5 s for knights and bishops, 3 s for rooks, 3.5 s for queens. There is also a 0.3 s anti-spam gap. Pieces move like chess pieces, with no check rules, castling or en passant, and pawns promote to queens. Taking the king wins. After five minutes, material decides. The server orders simultaneous moves. Clients replay each confirmed move with the server timestamp, so cooldowns stay in sync. Fights play at 2.2× speed (`packages/shared/src/arcade/engine.ts`).

### Pre-match draft, sabotage and killstreaks
Every match with a human starts with a 20 s **draft** (`PICK_MS`). Each player picks an army; the opponent sees only "choosing…" or "locked in" until both lock in. The server then rebuilds the engine with the chosen doctrines.
In **War Chess** each side also secretly picks a **sabotage card**:
- *Minefield:* two extra hidden mines.
- *Sleeper Charge:* destroy one enemy pawn, knight or bishop.
- *Saboteur:* two enemy pieces start jammed for 3 turns.
- *Signal Jammer:* enemy abilities start on cooldown.

**Killstreaks:** capture 2 pieces in a row before the enemy takes one and you earn an **Airstrike**. It destroys the target and every adjacent enemy piece, never the king.

### Scrap Poker
No-limit Texas Hold'em (`packages/shared/src/poker/holdem.ts`: hand evaluator, betting rounds, side pots, Monte-Carlo bot equity). A seat buys in with a whole robot: 10 parts paid from the credit bank. Every chip lost strips a part off your robot, and chips won pile up beside you as scrap. Leaving the table cashes your stack back into the bank, the same bank the Derby uses. Bots fill seats whenever a human is playing. Hole cards are filtered per viewer until showdown.

### Music and admin
Admins upload tracks (MP3/OGG/M4A/WAV/FLAC, sniffed by magic bytes, up to 30 MB) to a shared playlist on the Admin screen. Every player controls their own listening from the ♪ menu: play, skip, shuffle, hide tracks, or switch back to the game score. Playback runs through the music bus, so the volume and ducking settings apply. To become admin, an account enters the server's `ADMIN_CODE` under Profile → Account → Admin access.

### Accounts
Guests get a device-bound identity. Accounts have a callsign and password (scrypt-hashed, per-device sessions, rate-limited logins). A guest can be secured later from the profile.

### Multiplayer
Quick-match pairs compatible players into **simultaneous matches** (rating window widens with wait time). King-of-the-Board tables keep a champion and a challenger queue: winner stays, loser walks, short countdown, board resets. Players can challenge anyone in the lobby, create private matches by code, spectate any public match live, chat and emote. Matches persist while active and are restored after a server restart.

## Factions and assets

The four armies are built by `tools/blender/build_polygon.py`. It uses **Synty POLYGON** characters (Sci-Fi City, Generic, Western, Spy), which are low-poly with realistic proportions, all on one shared skeleton, with POLYGON weapons held in the hand bone. The older cartoon builder, `tools/blender/build_factions.py`, still provides the shared utilities and the animation sources:

* **Synty POLYGON packs + Simple Apocalypse animations** (Unity Asset Store cache, `%APPDATA%/Unity/Asset Store-5.x`). They are extracted with `tools/asset-pipeline/extract_unitypackage.py` into `.asset-cache/`, never modifying the source packages.
* **Quaternius Ultimate Animated Animals (CC0)** — the horse used by every Knight (mounted riders keep the chess-knight silhouette).

Pipeline highlights:
* The Synty animation takes use the older *SimplePeople* skeleton while the Apocalypse characters use a different rig; clips are **retargeted in Blender** with a rest-offset-preserving world-space bake and an explicit bone map, then exported once as `anims/synty_humanoid.glb` (20 clips) shared by every humanoid piece.
* Weapons, crowns/coronets/mitres/battlements, robot plates and riders are **rigidly skinned** to their bones and merged into one skinned mesh per piece (glTF bone-parenting is unreliable across tools; skinning is not).
* Machines robots are built procedurally from plates on the same humanoid rig (so they reuse all clips); the Machines Knight rides a plated mechanical steed.
* Faction identity comes from per-faction texture recolouring (olive military, rust/grime, Vault white-blue) plus readable class silhouettes and an engraved glyph on every pedestal.
* `public/assets/manifest.json` tells the client what exists; anything missing falls back to the procedural pieces, so the game always runs.

Sound effects are synthesised by `tools/audio/make_sfx.py` (numpy + ffmpeg): physically inspired gunshots, blades, impacts, hooves and crowds. They are original, so they are committed.

Run `npm run assets:build` (needs `blender` on PATH, or call the Blender executable directly as in the scripts' headers), then `npm run assets:optimize`.

**Licensing:** Synty assets are licensed to you through the Unity Asset Store EULA — they may ship inside the game but must not be redistributed as raw assets. The generated GLBs are therefore build artifacts and are git-ignored. Stockfish is GPLv3 (served unmodified as a separate file from `node_modules/stockfish`). Quaternius assets are CC0.

## Custom armies

Army Creator (lobby → *Custom Army Creator*):
1. Upload GLB / GLTF(+bin+textures) / FBX / OBJ(+MTL) or a ZIP per class. Everything is normalised and re-exported as one self-contained GLB, then uploaded; the **server re-measures the GLB** (triangles, bones, clips, external textures) instead of trusting the client.
2. Fit: auto-fit to the class height, rotate, scale, move the origin, preview with neighbouring pieces, footprint and height guides.
3. Animation: clips auto-map by name (e.g. `Armature|Death02` → `DEATH_LIGHT`); map anything manually, retarget library clips onto compatible humanoid rigs, or explicitly accept procedural fallbacks.
4. Deaths: choose compatible death categories.
5. Kill sequences: author fights on a visual timeline (drag events, edit properties) and preview them on the real board; bind a sequence per class.
6. Validate: required classes/actions, clip lengths, textures, skeleton, footprint/height, performance budget, plus a live FPS test with 32 animated pieces. **Public matchmaking requires a valid army; private/local games accept fallbacks.**

## Deployment

The client is static; multiplayer needs a Node process with WebSockets.

* **Docker** (what runs at ai.jteam.ca/Ashengambit): see `Dockerfile` and `deploy/docker-compose.yml` (app + Postgres, Traefik labels, served under a sub-path via `VITE_BASE`). Put `POSTGRES_PASSWORD`, `ADMIN_CODE` and `ADMIN_NAMES` in `deploy/.env`, include the locally built `apps/client/public/assets/{factions,anims,environment.glb}` in the build context, then run `docker compose up -d --build`.
* **Single Node host** (VPS, Render, Fly, a Hostinger Node app…): `npm ci && npm run build && npm start`. The server serves `apps/client/dist` and the API on `PORT`. Set `DATABASE_URL` for PostgreSQL, `CORS_ORIGIN`, `DEV_TOOLS=0`, `ADMIN_NAMES=…`.
* **Static-only hosting** (e.g. an FTP web root): upload `apps/client/dist/` — practice vs AI, local 2-player, replays of local games, the Army Creator preview and the Combat Laboratory work offline. Online play needs the Node server running somewhere reachable; point the client at it with a reverse proxy for `/socket.io`, `/api` and `/uploads`.

Environment variables: `PORT`, `DATABASE_URL`, `DATA_DIR`, `UPLOAD_DIR`, `CLIENT_DIST`, `CORS_ORIGIN`, `DEV_TOOLS`, `ADMIN_NAMES`, `ADMIN_CODE`, `KOTB_ARENAS`, `PICK_MS`, `DERBY` (0 disables), `DERBY_FAST`.

**Building from a fresh clone:** the 3D armies are not in the repository because Synty assets can't be redistributed. Without them the game falls back to procedural pieces. To build the real armies you need your own licences for the Synty packs listed above. Then run `npm run assets:build && npm run assets:optimize`.

## Development tools

* **Dev console** (<kbd>`</kbd>): renderer stats, camera modes, faction/FEN sandbox, spawn pieces, checkmate test, simulated lobby players, bot-vs-bot spectating, forced resync, disconnect simulation, live ability state.
* **Combat Laboratory**: pick attacker/defender class + faction, finisher and death; see which fallback key matched; play, pause, step frame-by-frame and scrub the timeline (deterministic re-simulation).
* **Visual QA hook** (dev builds only): `window.__ashen.shot(name)` renders a full-size frame to `.qa/<name>.png` through the Vite dev server.

## Status / roadmap

Implemented end-to-end and tested: rules, War Chess, Battle Checkers, Wasteland Derby (betting, secret upgrades, server-simulated races), server authority, lobby, quick match, simultaneous matches, King of the Board, spectating, chat/emotes, reconnect, persistence, Elo/stats/achievements, history + replay, AI (Stockfish), local play, four Blender-built armies with skeletal combat, procedural fallback art, on-board fights for every class with 18 finishers, death system, checkmate sequence, custom army import/mapping/validation, Kill Sequence Editor, Combat Laboratory, dev console.

Next steps: authored sound files (every sound id is already a hook), ability-aware AI layer, more matchup-specific finisher overrides, LOD generation in the Blender pipeline, password/OAuth accounts on top of the guest tokens, and a Postgres-backed integration test run (the Postgres repository is implemented but this machine had no running Postgres/Docker).
