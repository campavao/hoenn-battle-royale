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
| `join_room` | `code, name, spectate?, pass?, skin?, patch?, protocol?, token?` | `room_joined {code, id, host, token}` or `room_error {reason}`. With a `token` naming a seat the room is still holding (a socket that dropped within `rejoinMs`, 60 s), the same `id` comes back whatever the door says -- locked, full or passcoded -- and the token is spent (POK-284). A token whose socket the relay still has (a page that gave up on a half-open one) takes the seat over, host and all, and the old socket is closed. A member who sent `leave_room` or was removed is not held |
| `stat` | `id, v, solo, since` | play counter; logged, counted, never answered |
| `lock_room` | `locked, bots?` | host only: refuse new joiners (match in progress). `bots`: the seats the host dealt its bots, never handed to a member until the unlock |
| `kick` | `id` | host only: remove a member, ban their address and their resume token from the room |
| `leave_room` | | |
| `can_host` | `ok` | opt in/out of host migration |
| `to` | `id, m` | unicast `m` to one member |
| `all` | `m` | `m` to every other member |
| `ping` | | -> `pong` |
| `info` | | -> `info {motd, rooms, conns, minProtocol, daily?}` |
| `daily_join` | `name, skin?, patch?, protocol?` | the one shared DAILY GAME room: joins it, hosts it, or `match_in_progress` while it runs. A daily of another build is skipped (the version gate), so each build gets its own. A daily waiting on its dropped host is still the daily: its lobby takes you (and your `can_host` makes you its host), its match is answered `match_in_progress` |
| `quick_join` | `name, skin?, patch?, protocol?` | joins the fullest open room of the same build, or `no_open_rooms` (the page then hosts one) |
| `set_open` | `open` | host only: open/close the room to `quick_join` |

Server -> client:

| type | fields | when |
| --- | --- | --- |
| `roster` | `code, host, open, max, seats, pass, members:[{id,name,spectate?}]` | on every room change. `max`: the humans the room seats (the host's MAX, clamped to 16); `seats`: the MAX the host asked for (up to 30), which bots fill |
| `rooms` | `rooms:[{code, host, skin?, players, seats, pass, full}]` | reply to `list_rooms`. `full`: the door would refuse a join (it counts watchers and free ids, which `players`/`seats` cannot) |
| `recv` | `from, m` | a `to`/`all` delivery |
| `room_closed` | `reason` | the host left with no heir, or dropped and did not come back inside the seat hold (`host_gone`), or you were kicked (`removed`). The room is over: the page closes its socket rather than reconnecting to it |
| `room_hosted` | `code, id, token` | your `host_room`/`daily_join` succeeded; `token` claims this seat back after a drop |
| `room_joined` | `code, id, host, token` | your `join_room`/`quick_join` succeeded; `token` claims this seat back after a drop |
| `room_error` | `reason` (`not_found`, `full`, `locked`, `passcode`, `removed`, `already_in_room`, `server_full`, `version`) | a request was refused |
| `no_open_rooms` | | `quick_join` found nothing open or running |
| `match_in_progress` | `code, members` | nothing joinable, but a match is running |
| `pong` | `t?` | reply to `ping` |
| `info` | `motd, rooms, conns, minProtocol, daily?` | reply to `info`, and pushed once, unasked, right after connect |

Ids are seats: `1..31` (the page's wire and the ROM have 32; 0 is SOLO VS
BOTS'), the lowest one that is not a member's, not held for one who dropped,
and not used since the match locked the door -- nor a bot's. When none is left
the door says `full`, whatever MAX says. The heir is the earliest arrival that
can host, by the room's own count, since the lowest id is no longer the
oldest, and never a watcher: it is not in the match (every page says
`can_host` on arrival, watchers too), and the unlock that seats it makes it
eligible. A host that drops with no heir (alone with its bots, or the last one
standing) is waited for through the same seat hold: the roster keeps naming
it, the door takes nobody new (except the daily's lobby, which is
nobody's in particular), and its token makes it host again. A member
(not a watcher) that sends `can_host` meanwhile takes the room over instead; if nobody does
and the hold runs out, the room closes with `host_gone`. The host is whoever created the room. Codes use the alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ`
(no `0 O 1 I L`), so a code read aloud never has to be checked twice.

### The version gate

`host_room` and `daily_join` may carry `{patch, protocol}` -- the host's
version -- which the room remembers. Every other way in may carry the same
pair for the joining client. `patch` is the sha1 of the ROM running in the
page's tab (POK-330 #3), a string; a number from an older page is compared as
its string. `protocol.fixtures.json` in this directory is exactly what the
page sends, and both test suites read it.

When both sides said something and it disagrees, a door you named
(`join_room`, watchers included) refuses with
`room_error {reason: "version", host: {patch, protocol}}`. A door the relay
picks for you walks past the room instead: `quick_join` takes the fullest room
of your own build (or answers `no_open_rooms`, and you host), and `daily_join`
seats you in the daily of your own build, opening one if there is none. Right
after a deploy the fullest room is often the old build's, and telling an
up-to-date player to reload cannot help them. Either side saying nothing (an
older client, or one that opts out) skips the check entirely -- nobody is
refused for silence.

`info` also carries `minProtocol`, read from `BR_MIN_PROTOCOL` (default `1`)
so a client can decide for itself whether it is too old to bother connecting,
before it sends anything.

### Behind a proxy

On Railway every socket arrives from the edge proxy's own address, so without
help the relay sees one client: the 24-per-address cap is shared by
strangers, and a `kick` bans everybody who came in through the same edge.
`BR_TRUST_PROXY=1` makes a client's address the proxy's `X-Real-IP`, or
failing that the entry the proxy appended to `X-Forwarded-For` (the last one;
anything before it is whatever the client sent). Set it only behind a proxy
that writes those headers: with none in front, they are the client's to
invent. A kick also bans the removed member's resume token, which is what
their page presents on every automatic rejoin, from any address.

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
| `BR_TRUST_PROXY` | unset | `1`: a client's address is the proxy's `X-Real-IP`, else the last `X-Forwarded-For` entry. **Set it on Railway** |

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

Rooms live in memory, so a deploy ends every one. On SIGTERM the relay logs
its counters once more (`SIGTERM: shutting down | rooms ...`), lets go of
every room without a roster or an heir, and closes each socket with 1012
(service restart), which the page tells apart from its own network dropping. `/health` answers `{status, rooms, conns, locked}`, where
`locked` is the matches running: deploy at `locked: 0`.

Run from inside `relay/` -- the service is **`hoenn-relay`**, separate from
the Kanto mod's relay (`kanto-br-relay`) and its own Railway project.
`railway.json` in this directory pins the Nixpacks builder and start command.

On Railway: Settings -> Networking -> **turn App Sleeping off** (a sleeping
relay drops every room it is holding), and set the healthcheck path to
`/health`. Unlike the Kanto relay this one is plain HTTP/WebSocket on one
port, so no TCP Proxy step is needed -- Railway's own HTTP domain reaches it
directly (`wss://<domain>`).
