# LAN endpoint configuration

The configuration and registration helpers are available in `src/config.js`.
They do not start a listener, configure networking or install an extension.
Controller and command integration are separate implementation units.

## Choose an explicit listener address

| Environment variable | Meaning |
| --- | --- |
| `GENTLE_CANVAS_LAN_HOST` | Required concrete IPv4 or IPv6 bind address. No automatic NIC selection. |
| `GENTLE_CANVAS_LAN_PORT` | Listener port; defaults to `34316` only when absent. Explicit values must be decimal integers from `1` to `65535`. |
| `GENTLE_CANVAS_LAN_PUBLIC_ORIGIN` | Optional external HTTP/HTTPS origin; otherwise derived from the bind address and port. |

For example, supply these variables to the future extension host process:

```sh
export GENTLE_CANVAS_LAN_HOST=192.168.1.20
export GENTLE_CANVAS_LAN_PORT=34316
```

Use an address assigned to the Linux host. Hostnames, wildcard/unspecified
addresses (`0.0.0.0`, `::`), multicast addresses and scoped IPv6 literals are
rejected. IPv4-mapped unspecified and multicast addresses are also rejected.
Loopback addresses are allowed for tests or a reverse proxy on the same host.
IPv6 literals are configured without brackets; derived origins add brackets.
Invalid explicit settings fail rather than silently falling back to defaults.

For later TLS termination, configure an external origin explicitly:

```sh
export GENTLE_CANVAS_LAN_HOST=127.0.0.1
export GENTLE_CANVAS_LAN_PUBLIC_ORIGIN=https://canvas.example
```

An origin contains only scheme, host and optional valid port. Credentials,
paths (including a trailing `/`), query strings and fragments are rejected.
Origins are canonicalized, including omission of default HTTP/HTTPS ports.
The configuration helper does not read or trust forwarded request headers.

## Persisted menu settings

`/canvas:lan setup` writes `$XDG_CONFIG_HOME/gentle-canvas-lan/config.json`
(default `~/.config/gentle-canvas-lan/config.json`) with `host`, `port` and an
optional `publicOrigin`. The file is created with mode `0600` and replaced
atomically after validating the complete trio. Environment variables override
saved values individually, so an exported `GENTLE_CANVAS_LAN_PORT` wins over
the menu while it is set. Saving disposes the running proxy; reopen the design
or run `/canvas:lan start` to bind the new endpoint.

## Register a trusted canvas URL

`readConfig(env = process.env)` returns a frozen `{host, port, publicOrigin}`.
`parseCanvasUrl(url)` returns a frozen `{url, origin, token}`. It accepts only
strings with HTTP, exactly `127.0.0.1` or `localhost`, an explicit port from
`1` to `65535`, and a first raw path segment matching
`[A-Za-z0-9_-]{16,128}`. `localhost` is normalized to `127.0.0.1` to match the
canvas server's actual IPv4 binding. Default port 80 is omitted in the result.

Selected paths and queries are retained, for example:

```text
http://localhost:43210/Abcd_0123456789-x/files/design.html?view=2
→ http://127.0.0.1:43210/Abcd_0123456789-x/files/design.html?view=2
```

Credentials, fragments, whitespace/control characters, backslashes, alternate
loopback spellings, encoded tokens, dot segments (including encoded dots) and
encoded path separators are rejected before URL normalization can hide them.

`createCanvasRegistry()` provides `register(url)`, `clear()` and a read-only
`current` getter, initially `null`. Registration validates before replacing
the previous frozen descriptor; failure leaves it unchanged. Successful
registration replaces both the dynamic port and token. Clearing is repeatable.
The registry is memory-only and never discovers targets from client requests.
The later controller must feed it trusted successful canvas results and handle
listener/stream lifecycle; registration itself does not close stale streams.

## Operational boundaries

HTTP is unencrypted. Tokenized URLs are sensitive capabilities: do not persist
them in logs or accept upstream targets supplied by network clients. Sharing
supports canvas actions, including comments; it is not read-only access.
Restrict network access to trusted devices with your own firewall policy.
These helpers do not modify firewall rules, provide authentication or configure
a reverse proxy. Exposing the canvas does not expose the application being
compared; application links to `localhost` still refer to the viewing device.
Headless operation requires no host browser. Real canvas integration and access
from another LAN device remain separate verification steps.
