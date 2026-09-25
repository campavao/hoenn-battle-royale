# Hoenn Battle Royale relay

N players in one room, every message forwarded. WebSocket, one JSON object
per text frame. Ported from the Kanto Battle Royale relay
(`gen1recomp-multiplayer`, `mods/battle_royale/relay/server.js`, plain TCP +
newline-JSON) so a browser -- and anything else that only speaks WebSocket --
can reach it directly, with no TCP proxy in front.

Nothing here knows what a battle or a step is: a room is a set of
connections, and the server's whole job is to hand each message to the
member it names (or to everyone else) and to keep the roster honest when
someone drops. Game rules live in the host player's client.

One dependency: `ws`.

## Running it

```sh
cd relay
npm install
node server.js   # :7790 (PORT or BR_RELAY_PORT to change)
```

## Messages

Client -> server:

| type | fields | does |
| --- | --- | --- |
| `host_room` | `name, open?, max?, skin?, pass?, patch?, protocol?` | opens a room; `room_hosted {code, id, token}` then a roster |
| `set_max` | `max` | host only: room size, live |
| `set_pass` | `pass` | host only: passcode, live; empty/absent clears it |
| `set_skin` | `skin` | what this member looks like, live |
| `list_rooms` | | `rooms {rooms:[...]}`: every joinable lobby |
| `join_room` | `code, name, spectate?, pass?, skin?, patch?, protocol?, token?` | `room_joined {code, id, host, token}` or `room_error {reason}`. With a `token` naming a seat the room is still holding (a socket that dropped within `rejoinMs`, 60 s), the same `id` comes back whatever the door says -- locked or full -- and the token is spent (POK-284). A member who sent `leave_room` or was removed is not held |
| `stat` | `id, v, solo, since` | play counter; logged, counted, never answered |
| `lock_room` | `locked` | host only: refuse new joiners (match in progress) |
| `kick` | `id` | host only: remove a member, ban their IP from the room |
| `leave_room` | | |
| `can_host` | `ok` | opt in/out of host migration |
| `to` | `id, m` | unicast `m` to one member |
| `all` | `m` | `m` to every other member |
| `ping` | | -> `pong` |
| `info` | | -> `info {motd, rooms, conns, minProtocol, daily?}` |
| `daily_join` | `name` | the one shared DAILY GAME room |
| `quick_join` | `name, patch?, protocol?` | joins the fullest open room, or hosts one |
| `set_open` | `open` | host only: open/close the room to `quick_join` |

Server -> client:

| type | fields | when |
| --- | --- | --- |
| `roster` | `code, host, open, max, pass, members:[{id,name,spectate?}]` | on every room change |
| `rooms` | `rooms:[...]` | reply to `list_rooms` |
| `recv` | `from, m` | a `to`/`all` delivery |
| `room_closed` | `reason` | the host left with no heir, or you were kicked (`reason:"removed"`) |
| `room_hosted` | `code, id, token` | your `host_room`/`daily_join` succeeded; `token` claims this seat back after a drop |
| `room_joined` | `code, id, host, token` | your `join_room`/`quick_join` succeeded; `token` claims this seat back after a drop |
| `room_error` | `reason` (`not_found`, `full`, `locked`, `passcode`, `removed`, `already_in_room`, `server_full`, `version`) | a request was refused |
| `no_open_rooms` | | `quick_join` found nothing open or running |
| `match_in_progress` | `code, members` | nothing joinable, but a match is running |
| `pong` | `t?` | reply to `ping` |
| `info` | `motd, rooms, conns, minProtocol, daily?` | reply to `info`, and pushed once, unasked, right after connect |

Ids are small integers handed out per room, never reused within it; the host
is whoever created the room. Codes use the alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ`
(no `0 O 1 I L`), so a code read aloud never has to be checked twice.

### The version gate

`host_room` may carry `{patch, protocol}` -- the host's version -- which the
room remembers. `join_room` and `quick_join` may carry the same pair for the
joining client. When both sides said something and it disagrees, the join is
refused with `room_error {reason: "version", host: {patch, protocol}}`.
Either side saying nothing (an older client, or one that opts out) skips the
check entirely -- nobody is refused for silence.

`info` also carries `minProtocol`, read from `BR_MIN_PROTOCOL` (default `1`)
so a client can decide for itself whether it is too old to bother connecting,
before it sends anything.

### Origins

`BR_ORIGINS` is a comma-separated allow-list of `Origin` header values,
checked in the WebSocket upgrade handler before the handshake completes. Unset
or empty allows every origin (so local dev, and any client that sends no
`Origin` header at all -- the game itself, most non-browser WebSocket
libraries -- works with no configuration). A request whose `Origin` is set
and not on the list is refused before the upgrade completes.

## Environment variables

| var | default | |
| --- | --- | --- |
| `PORT` / `BR_RELAY_PORT` | `7790` | listen port |
| `HOST` | `0.0.0.0` | listen host |
| `BR_MAX_ROOMS` | `40` | concurrent room ceiling |
| `BR_MAX_CONNS` | `200` | concurrent connection ceiling (24 per IP, fixed) |
| `BR_LINES_PER_SEC` | `120` | sustained message rate per connection |
| `BR_BURST_LINES` | `1200` | token bucket depth per connection |
| `BR_MOTD` | unset | up to 3 rows x 17 cols, shown by `info` |
| `BR_DAILY` | unset | `HH:MM|IANA timezone|label` for the DAILY GAME |
| `BR_MIN_PROTOCOL` | `1` | advertised in `info` as `minProtocol` |
| `BR_ORIGINS` | unset (allow all) | comma-separated `Origin` allow-list |

A ceiling that is not a positive number (`BR_MAX_ROOMS=forty`, `0`) is
ignored with a log line and the default stands; it used to switch the cap off.

Besides the line bucket, each connection has a byte bucket (64 KB/s, 1 MB
deep, both times four for a host) and a send backlog ceiling (1 MB of output
the peer has not read). Past either, the socket is dropped (`flood_bytes`,
`slow_consumer` on its drop line).

## Tests

```sh
cd relay
node --test
```

Drives the relay over real WebSocket connections on an ephemeral port: host,
join, roster fan-out, unicast and broadcast routing, the error reasons the
client shows, locking, host migration, the passcode, the version gate,
flood disconnect, the idle/unbound sweep, and `/health`.

## Deploying

```sh
railway up
```

Run from inside `relay/` -- the service is **`hoenn-relay`**, separate from
the Kanto mod's relay (`kanto-br-relay`) and its own Railway project.
`railway.json` in this directory pins the Nixpacks builder and start command.

On Railway: Settings -> Networking -> **turn App Sleeping off** (a sleeping
relay drops every room it is holding), and set the healthcheck path to
`/health`. Unlike the Kanto relay this one is plain HTTP/WebSocket on one
port, so no TCP Proxy step is needed -- Railway's own HTTP domain reaches it
directly (`wss://<domain>`).
