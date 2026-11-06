# HANDOFF / MEMORY — VANTA NODE

Working dir: `C:\Users\UmarA\Downloads\nte-matchmaker-core-park\nte-matchmaker-core`
Last updated: 2026-11-07

## What this project is

A server-authoritative realtime multiplayer systems sandbox, positioned as a portfolio-grade
engineering piece. The earlier Piko Park / PIKO OPS presentation has been fully replaced by
**VANTA NODE** branding and operator-console framing. There are no external franchise references,
characters or assets.

The product is one deployable:

- Node.js authoritative simulation at a 50 ms tick (20 Hz `PARK_STATE`).
- WebSocket intent protocol plus a REST telemetry surface.
- JWT HS512 session tokens, flood control and chat moderation.
- Solo exploration is fully playable; co-op operations unlock at 2+ operators.
- Vanilla Canvas client with no build step, image assets or audio assets.

## Run it

```powershell
npm install
npm start          # http://localhost:3000
npm run bots       # optional: 4 test operators in a second terminal
```

- Free the port if busy:
  `Get-NetTCPConnection -LocalPort 3000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`
- No `JWT_SECRET` → ephemeral key → restart logs everyone out (accepted).
- In-memory DB → restart wipes profiles/cosmetics (accepted).

## File inventory

- `index.html` — entire client: base CSS, `#telemetry-theme` override block, HUD markup, one
  `<script>` IIFE. Includes the system overview modal, runtime telemetry block and sprite renderer.
- `park.js` — authoritative simulation + all content definitions and user-facing event copy.
- `server.js` — Express REST + WS gateway + heartbeat + flood control + moderation. Health:
  `GET /api/health`; sector snapshot: `GET /api/park`.
- `db.js` — in-memory profiles/XP/leaderboards/chat log; `xpForLevel(l) = (l-1)^2 * 60`.
- `auth.js` — JWT HS512, secret = hex or passphrase.
- `bots.js` — test operators.
- **DELETED: `battle.js`, `matchmaker.js`** (do not recreate or search for them).
- `README.md`, `HANDOFF.md`, `package.json` (name `vanta-node`), `start.bat`.

## Protocol (do not break)

- Client→server: `JOIN_PARK`, `LEAVE_PARK`, `PARK_MOVE {dx,dy,sprint}`, `PARK_DASH`, `PARK_HOP`,
  `PARK_EMOTE`, `PARK_INTERACT`, `PARK_ACTIVITY {activity}`, `PARK_ACTIVITY_MENU`,
  `PARK_COSMETIC`, `PARK_PING {t}`, `SEND_MESSAGE`.
- Server→client: `LOBBY_JOINED`, `PARK_JOINED`, `PARK_STATE` (20 Hz), `PARK_LEFT`, `PARK_PROFILE`,
  `PARK_EVENT`, `PARK_CHALLENGE`, `PARK_ACTIVITY_MENU`, `PARK_PONG`, `LOBBY_CHAT`,
  `SYSTEM_WARNING`, `MODERATION_ACTION`, `NOTICE`, `ERROR`, `AUTH_FAIL`.
- Activity IDs stay `gauntlet`, `tag`, `dance`, `treasure`. Display names are:
  Sync Sequence / Signal Transfer / Motion Sync Drill / Data Recovery.
- Constants: world 1800×1100, `PLAYER_R=14`, `INTERACT_R=62`, `TICK_MS=50`, dash cooldown 1100 ms.
- `challenge.cooldownUntil` and `bell.ringAt` are epoch ms; client uses `Date.now() + G.clockOffset`.
- Auto-start only after 45 s idle with 2+ operators, 12 s cooldown after each operation.
  Chat restriction at score ≥40; 3 strikes = ban.

## Brand and visual system

1. Brand: **VANTA** / **VANTA NODE**, "realtime multiplayer systems sandbox".
2. Palette in `:root`: bg `#070A13`, panel ink `#03050A`, grid `#0D1321`, accent `#00D2FF`,
   verified `#10B981`, error `#FF4D5E`, 4 px radii, mono stack. Theme rules live in a single
   appended `<style id="telemetry-theme">` block.
3. Canvas world is a dark industrial sector: steel paths, coolant reservoir, firewall gate and
   **Data Synchronization Portals**. Portals turn emerald when a player locks on.
4. Top-left card: `N-01 RUNTIME TELEMETRY`, `ROLE: REPLICA_CLIENT`, heap/loop/stamina bars,
   uptime/XP. Bottom chips: `LATENCY`, `FRAME_RATE`, `STATE`, `PROTOCOL: WSS`, `MEM`.
5. Tabs: `SYSTEM / COMMS / MODULES / ROSTER / EVENTS`.
6. Operators are a 14×16 pixel matrix (`AGENT_SPRITE`): helmet, luminous visor strip, chest accent,
   armoured legs. Head modules and companion drones are drawn hardware, not emoji.
7. Emotes render as mono chips (`[WAVE]`, `[SYNC]`, `[ACK]`, …) both in the bar and above actors.
8. **SYS** opens the SYSTEM OVERVIEW modal with factual server/client/operations architecture.
9. SYSTEM tab includes a compact runtime block: session uptime, snapshot Hz, round trip, entities.

## Verification state

Verified live in-browser at desktop `1280×720`, tablet `820×1180`, mobile `390×844`:

- login, session restore, movement, collision, interaction prompts
- portal cyan → emerald handshake and terminal log
- operation start/end for all four types; bots online; co-op unlock
- shop purchase/equip; head modules and drones render as hardware
- chat terminal format and moderation lockdown
- zero console errors; `node --check` clean for all server files and the extracted client script

## Gotchas

- Client script must stay a single `<script>` block. Syntax-check:
  `node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');fs.writeFileSync(process.env.TEMP+'/vanta-client.js',h.match(/<script>([\s\S]*?)<\/script>/)[1])" ; node --check $env:TEMP\vanta-client.js`
  then `node --check park.js server.js db.js auth.js bots.js`.
- `park.js` `icon`/`emoji` fields are intentionally empty; do not re-add emoji to server events.
- `snapshot.interactHint` is always null — the client computes the interaction prompt.
- `matchmaker.js` does not exist.
- `.panel-toggle{display:none}` by default; visible ≤1050 px.
- Test screenshots are junk and safe to delete.
