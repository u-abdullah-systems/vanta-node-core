# VANTA NODE

**A server-authoritative realtime multiplayer systems sandbox.**

VANTA NODE is a small, complete multiplayer product built to demonstrate the parts of realtime
engineering that are easy to hand-wave and hard to get right: **authority, tick rate, replication,
latency, packet pressure, session lifecycle and moderation**.

One Node.js process serves the static client, a REST surface and a WebSocket gateway. The server
simulates the world; the browser is a replica that sends intent and renders snapshots. There is no
build step, no database service, and no image or audio assets.

---

## At a glance

| | |
|---|---|
| **Simulation** | Authoritative Node.js loop, fixed **50 ms** tick |
| **Replication** | `PARK_STATE` broadcast from the loop, **change-gated**; remote actors interpolated client-side |
| **Transport** | WebSocket JSON for realtime, REST for auth, health and read models |
| **Auth** | JWT **HS512**, issued by `POST /api/auth/login`, verified on the WS upgrade |
| **Client** | Single-file vanilla JS + **Canvas 2D**, no framework, no build step, **zero assets** |
| **Storage** | In-memory profiles, XP, leaderboards and chat log |
| **Dependencies** | `express`, `ws`, `jsonwebtoken`, `uuid` |
| **Runtime** | Node **18+**, one process, one port |

---

## Run it

```bash
npm install
npm start
# http://localhost:3000
```

Enter an operator ID, choose a chassis colour, and deploy. The session restores on reload while the
server process is alive.

```bash
npm run dev    # Node watch mode
npm run bots   # four headless test operators in a second terminal
```

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP and WebSocket port |
| `JWT_SECRET` | random per boot | Token signing key. Set it to keep sessions across restarts. |

> With the default ephemeral secret, a server restart invalidates every token. That is deliberate:
> the demo has no password store, and reset semantics are explicit.

---

## 60-second tour

1. Open `http://localhost:3000` in two tabs and deploy both operators.
2. Move with **WASD**; the HUD latency, frame rate and snapshot rate update live.
3. Open the **SYSTEM** tab and start **Signal Transfer** — the 2-operator co-op operation.
4. Watch the operation banner, the trace indicator in **ROSTER**, and the `PARK_CHALLENGE` flow.
5. Press **SYS** for the architecture overview: authority model, tick rate, auth and protocol.
6. Stop the server. The client degrades to a reconnect loop rather than pretending to be connected.

---

## Engineering highlights

| Area | Implementation |
|---|---|
| **Authority model** | The server owns position, collision, stamina, cargo, scoring, challenge state and cosmetics. The client cannot mutate world state; it only sends intent. |
| **Tick / replication** | Fixed 50 ms simulation tick. A snapshot is serialised each tick and broadcast only when it changes, so idle scenes do not burn bandwidth. |
| **Protocol design** | Small typed JSON packets with explicit actions and a stable event set. Server-side activity IDs stay stable even when display copy changes. |
| **Session security** | JWT `HS512`; the WebSocket upgrade requires `?token=<jwt>`. Missing or invalid tokens are rejected before any gameplay packet is read. |
| **Abuse control** | Per-socket flood window (45 packets/second), heartbeat pruning, and a scored chat moderation pipeline with restrict/ban escalation. |
| **Observability** | `/api/health` exposes heap, uptime and socket count. The HUD derives snapshot rate, RTT, FPS and heap utilisation and renders them as instruments. |
| **Zero-asset rendering** | Operators, props, portals and effects are Canvas draw calls. Head modules and companion drones are drawn hardware, not emoji. |
| **Product surface** | XP curve, levels, quests, achievements, cosmetics, four co-op operations and a terminal-style comms channel fed by the same event stream. |

---

## Controls

| Input | Action |
|---|---|
| **WASD** / arrows | Move |
| **Shift** | Sprint |
| **Space** | Dash (stamina-gated, 1.1 s cooldown) |
| **E** | Interact — relay blooms, cargo, sync beacon, operations board, data cache |
| **1–9** | Broadcast emotes |
| **T** | Open comms |
| **M** | Mute |
| **P** | Clean render mode (hide HUD) |
| **Esc** | Close panel or system overview |

Touch devices receive a joystick plus dash and interact controls automatically.

---

## System architecture

```
index.html     Client: HUD, Canvas renderer, input, telemetry, module shop, comms, operations UI
server.js      Express REST API, WebSocket gateway, heartbeat, flood control, moderation
park.js        Authoritative simulation: movement, collisions, objects, operations, quests
db.js          In-memory profiles, XP curve, leaderboards, stats, chat log
auth.js        JWT HS512 creation and verification
bots.js        Optional headless test operators
```

```
 input intent                authoritative sim                 replicated state
 PARK_MOVE  ────────►  move / collide / tick  ────────►  PARK_STATE  ────────►  render
 PARK_DASH              cargo, portals, ops               PARK_EVENT            interpolate
 PARK_INTERACT          quests, progression               PARK_CHALLENGE        reconcile
```

One process serves the static client, the REST surface and the WebSocket gateway. There is no
bundler, database service or asset pipeline.

### Runtime sequence

1. The client authenticates over REST and receives a signed session token.
2. It opens `ws://…/?token=<jwt>`; the gateway verifies the token before accepting packets.
3. `JOIN_PARK` enrolls the operator and returns full world state and static geometry.
4. Input is sent as intent: `PARK_MOVE`, `PARK_DASH`, `PARK_INTERACT`, `PARK_ACTIVITY`.
5. The 50 ms tick advances the simulation and broadcasts `PARK_STATE` when the snapshot changes.
6. The client interpolates remote actors toward the newest snapshot and reconciles its own actor.
7. `PARK_EVENT` carries discrete outcomes: transfers, containment, beacons, progression.
8. `PARK_CHALLENGE` drives countdown → active → result for every operation.

---

## Protocol

Connect to `ws://localhost:3000/?token=<jwt>`, then send JSON packets with an `action` field.

**Client → server**

| Action | Payload | Purpose |
|---|---|---|
| `JOIN_PARK` | `{}` | Enter sector N-01 |
| `LEAVE_PARK` | `{}` | Return to standby |
| `PARK_MOVE` | `{ dx, dy, sprint }` | Movement intent, components in `[-1, 1]` |
| `PARK_DASH` | `{}` | Dash in the current direction |
| `PARK_HOP` | `{}` | Hop |
| `PARK_EMOTE` | `{ emote }` | Broadcast an emote |
| `PARK_INTERACT` | `{}` | Interact with the nearest object |
| `PARK_ACTIVITY` | `{ activity }` | Start an operation |
| `PARK_ACTIVITY_MENU` | `{}` | Request the operation list |
| `PARK_COSMETIC` | `{ kind, value }` | Equip or purchase `color`, `hat`, `pet` |
| `PARK_PING` | `{ t }` | Latency probe |
| `SEND_MESSAGE` | `{ message }` | Chat |

**Server → client**

| Event | Purpose |
|---|---|
| `LOBBY_JOINED` | Profile, shop, operations and achievement catalogue |
| `PARK_JOINED` | Full world, static geometry, players and profile |
| `PARK_STATE` | Snapshot of players, objects, challenge and environment |
| `PARK_LEFT` | Session left the sector |
| `PARK_PROFILE` | Updated coins, XP, level and quests |
| `PARK_EVENT` | Discrete gameplay and progression events |
| `PARK_CHALLENGE` | Operation countdown, active and ended phases |
| `PARK_ACTIVITY_MENU` | Operation definitions and current challenge |
| `PARK_PONG` | Ping reply |
| `LOBBY_CHAT` | Chat message |
| `SYSTEM_WARNING` / `MODERATION_ACTION` | Moderation state |
| `NOTICE` / `ERROR` / `AUTH_FAIL` | Informational and error events |

### REST API

| Endpoint | Description |
|---|---|
| `POST /api/auth/login` | `{ username, mmr }` → `{ ok, token, player }` |
| `GET /api/health` | Uptime, memory, player and socket counts |
| `GET /api/park` | Live sector summary and operation state |
| `GET /api/park/leaderboard?limit=20` | Top operators by XP |
| `GET /api/park/cosmetics` | Available colours, head modules and drones |
| `GET /api/profile/:username` | Public profile and stats |
| `GET /api/chat/logs` | Recent chat messages |

---

## Co-op operations

Operations are server-defined. Solo play is fully functional; two or more operators unlock the
competitive and social modes, and the server can rotate an operation in after an idle period.

| Code | Operation | Players | Objective |
|---|---|---|---|
| `SYNC` | **Sync Sequence** | 1+ | Hold all three sync nodes simultaneously for 2.5 s. Cargo counts as weight. |
| `TRC` | **Signal Transfer** | 2+ | One operator carries the trace. Touch another to transfer it. Most transfers wins. |
| `MOT` | **Motion Sync Drill** | 1+ | Broadcast emotes to raise sync count. Highest count wins. |
| `DCR` | **Data Recovery** | 1+ | Recover all six scattered data fragments. |

Stable server IDs: `gauntlet`, `tag`, `dance`, `treasure` — display copy can change without breaking
the protocol.

---

## Telemetry and observability

The HUD is a working instrument panel, not decoration.

| Metric | Source |
|---|---|
| `HEAP_UTIL` | `/api/health` → `memoryMB`, normalised against a 128 MB reference |
| `EVENT_LOOP` | WebSocket round trip from `PARK_PING` / `PARK_PONG` |
| `STAMINA` | Authoritative player state in `PARK_STATE` |
| `LATENCY` | Client-measured RTT |
| `FRAME_RATE` | `requestAnimationFrame` sampling |
| `STATE` | Client-computed `PARK_STATE` arrival rate over a 1 s window |
| `SESSION` | Time since the WebSocket link was established |
| `ENTITIES` | Live operator and collectible counts |

Because replication is change-gated, `STATE` reads below 20 Hz while the sector is idle and rises
toward 20 Hz under movement and operation load.

The **SYS** button opens a concise architecture overview: authority model, tick rate, auth,
transport, operations and the protocol surface. The copy mirrors the implementation.

---

## Progression and economy

- CRED is awarded for exploration, cargo delivery, beacons, operations and directives.
- XP follows `xpForLevel(level) = (level - 1)² × 60`; the level cap is 99.
- Directives are assigned from a pool and auto-claim on completion.
- Achievements cover travel, exploration, calibration, recovery, containment, co-op wins and weather.
- Cosmetics are chassis colours, **head modules** and **companion drones**. Purchases persist for
  the life of the process.

---

## Moderation and abuse control

- **Flood window:** more than 45 packets in one second is rejected per socket.
- **Heartbeat:** missed pong cycles terminate stale sockets.
- **Chat scoring:** normalisation plus term/category scoring produces a violation score.
- **Escalation:** restricted chat at the threshold, temporary ban after repeated violations.
- Moderation actions are broadcast to the sector and written to the event stream.

---

## Design decisions

**Why a JSON protocol instead of binary?** Readability and debuggability are the priority at this
scale. A binary codec is the obvious next step if entity counts or tick rates grow.

**Why is the client not authoritative?** It never was. Earlier framing called it an "authoritative
client", which was misleading; the role is labelled `REPLICA_CLIENT`. The server is the single
source of truth.

**Why change-gated snapshots instead of a blind 20 Hz firehose?** The simulation still ticks at
20 Hz, but an idle sector has nothing to say. Skipping identical snapshots keeps the wire quiet and
makes the `STATE` metric meaningful.

**Why in-memory storage?** It keeps the project dependency-light and makes reset semantics obvious.
Swapping `db.js` for SQLite or Postgres would not change the protocol.

**Why Canvas and procedural art?** It removes the asset pipeline and keeps the repository
self-contained. Every operator, prop, portal and effect is drawn from code.

---

## Verification

The build was exercised in a real browser against the live server:

- Desktop `1280×720`, tablet `820×1180`, mobile `390×844`
- Login, session restore, movement, collision and interaction prompts
- All four operations started manually and by rotation
- Portal handshake transitions cyan → emerald when an operator locks on
- CRED, XP, level, directive and achievement events
- Module purchase and equip for colours, head modules and drones
- Comms channel, moderation lockdown and reconnect paths
- Four test operators online; co-op unlock and operation start
- Zero console errors; `node --check` clean on every server file and the inline client

---

## Limitations and next steps

- Profiles and sessions are in memory; a restart clears them unless `JWT_SECRET` is fixed.
- Single process only. Horizontal scaling would need a shared state store and pub/sub fan-out.
- Movement is server-authoritative but not rollback-predicted; on high latency the local actor can
  feel one snapshot behind. Client-side prediction with reconciliation is the next networking task.
- Chat moderation is a scoring heuristic, not a production classifier.
- The REST surface is intentionally open for local evaluation; add real accounts and rate limits
  before exposing it publicly.
- A binary codec, delta compression and interest management are the natural follow-ups if the
  sector grows beyond a handful of operators.

---

## Project layout

```
.
├── index.html           client shell, theme, HUD, renderer and input
├── server.js            REST + WebSocket gateway + moderation
├── park.js              authoritative simulation and content definitions
├── db.js                in-memory player store and progression
├── auth.js              JWT HS512 helpers
├── bots.js              optional test operators
├── HANDOFF.md           working notes for future sessions
├── README.md
└── package.json
```

## License

MIT
