# Configuration

The listener is configured by environment variables (or the setup modal, which
persists them) and by the canvas registration learned at runtime. `src/config.js`
validates both.

## Environment

| Variable | Required | Meaning |
| --- | --- | --- |
| `GENTLE_CANVAS_LAN_IP` | yes | Concrete IPv4 or IPv6 address of this host. |
| `GENTLE_CANVAS_LAN_PORT` | no | Listener port, `1`–`65535`. Defaults to `34316`. |
| `GENTLE_CANVAS_LAN_PUBLIC_ORIGIN` | no | Exact `http(s)://host[:port]` origin used in links, for a reverse proxy that terminates TLS. |
| `GENTLE_CANVAS_LAN_MAX_BODY_BYTES` | no | Cap on request bodies forwarded upstream. Defaults to `52428800` (50 MB). |
| `GENTLE_CANVAS_LAN_MAX_CONNECTIONS` | no | Cap on concurrent client sockets. Defaults to `64`. |

Hostnames, wildcard or unspecified addresses (`0.0.0.0`, `::`), multicast addresses
and scoped IPv6 literals are rejected; loopback is allowed for tests or a reverse
proxy on the same host. IPv6 is written without brackets and derived origins add
them. An origin carries only scheme, host and an optional valid port: credentials,
paths (even a trailing `/`), query strings and fragments are rejected, and default
ports are dropped. Invalid values fail with a `TypeError` instead of falling back to
a default.

## Public origin resolution

A hostname public origin is resolved when settings are saved: a name that does not
resolve is rejected before anything is persisted. `/canvas-lan:status` reports where
a hostname origin points: the bind IP (direct exposure), another private address
(the reverse-proxy case), or a public address, which is flagged as a warning. An
origin hostname controlled by a third party would let that third party pass the
Origin gate, including POSTs, so keep the DNS record under your control.

## Setup modal

`/canvas-lan:setup` opens a centered modal with `IP to bind`, `Port` and optional
`Public origin`.

```text
╭─ ▤ Canvas LAN setup ──────────────────────────────────────────╮
│  ▸ IP to bind                                                 │
│  192.168.1.20▏                                                │
│                                                               │
│    Port                                                       │
│  34316                                                        │
│                                                               │
│    Public origin (optional; empty clears)                     │
│  https://canvas.example                                       │
│                                                               │
│  enter save   tab next   esc cancel                           │
╰───────────────────────────────────────────────────────────────╯
```

`tab` or the arrow keys move between fields, `enter` validates and saves, `esc`
cancels without writing. A rejected value is reported inside the modal and the form
stays open. Terminal widths below 30 columns get a compact list; hosts without
overlay support fall back to sequential prompts.

## Persisted settings

`$XDG_CONFIG_HOME/gentle-canvas-lan/config.json`, default
`~/.config/gentle-canvas-lan/config.json`, mode `0600`, replaced atomically:

```json
{ "ip": "192.168.1.20", "port": "34316", "publicOrigin": "https://canvas.example" }
```

Environment variables win per key over stored values. Saving rebuilds the proxy, so
reopen a design or run `/canvas-lan:start` to bind the new endpoint.

## Canvas registration

`readConfig(env)` returns a frozen `{host, port, publicOrigin}`, where `host` is the
bind address. `parseCanvasUrl(url)` returns a frozen `{url, origin, token}` and
accepts only `http://127.0.0.1` or `http://localhost` with an explicit port from `1`
to `65535` and a first path segment of `[A-Za-z0-9_-]{16,128}`. `localhost` is
normalized to `127.0.0.1`; the selected design path and query are kept.

Credentials, fragments, whitespace or control characters, backslashes, alternate
loopback spellings, encoded tokens, dot segments and encoded separators are
rejected before URL normalization can hide them.

`createCanvasRegistry()` holds one frozen descriptor in memory: `register(url)`
validates before replacing the previous value, `clear()` is repeatable, and `current`
is read-only or `null`. Targets are never discovered from client requests.

## Limits

Traffic is plain HTTP without authentication. Tokenized URLs are capabilities that
allow canvas actions, including comments. Keep the listener on trusted devices; this
code does not change firewall rules, provide authentication or configure a reverse
proxy. Application links that use `localhost` still point at the viewing device.
