# Public origin trust (finding #3)

How the proxy uses `GENTLE_CANVAS_LAN_PUBLIC_ORIGIN`, why a wrong hostname is
dangerous, and what the package does about it.

## The trust relationship

The proxy's Origin gate compares each request's `Origin` header with the
configured public origin. Only requests carrying that exact origin — or GETs
without an `Origin` header — pass, and passing requests may include POSTs such
as canvas comments. The public origin is therefore a **trusted value**: anyone
who controls it controls the gate.

When no public origin is configured, it is derived from the bind IP, which is
always an IP literal you chose — inherently trusted.

## The failure mode

If the configured origin's host is a **hostname whose DNS a third party
controls** (an expired domain, hijacked record, or a typo landing on someone
else's name), that third party can serve a page from their server, and any
browser visiting it will send requests whose `Origin` matches your proxy's
gate. The proxy would accept them, including state-changing POSTs, and rewrite
`Origin` to the loopback canvas so the canvas sees them as same-origin.

## What the package does (policy A'')

The package never blocks a working reverse-proxy topology — a hostname that
resolves to a different machine is legitimate — so the mitigation is
validation plus visibility, not a hard restriction:

1. **Save-time resolution check.** Saving settings with a hostname public
   origin requires the name to resolve at that moment. An unresolvable name
   (a typo, a deleted record) is rejected before anything is persisted.
2. **Status visibility.** `/canvas-lan:status` resolves the hostname and
   reports where it points:
   - the bind IP → "(this host)", direct exposure;
   - another private address → "(reverse proxy?)", the expected TLS topology;
   - a public address → an explicit warning.

## What remains your responsibility

- Keep the DNS record of the origin hostname under your control.
- Use a hostname you own; never accept a suggested origin you cannot verify.
- If you see "resolves to ... not the bind IP" and you do not run a reverse
  proxy at that address, treat it as an incident, not a warning.
