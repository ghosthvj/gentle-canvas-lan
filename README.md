# Gentle Canvas LAN

Access the Gentle Design canvas from a laptop or phone on your trusted LAN while Gentle Shell runs on a headless Linux host. No Tailscale required.

```text
http://LAN_IP:34316/<current-token>/
  -> fixed LAN listener
  -> http://127.0.0.1:<dynamic-canvas-port>/<current-token>/
```

The listener stays fixed; reopening a restarted canvas updates the upstream and displays the new tokenized LAN link. Old streams close and the old token is rejected.

**Status:** implementation in progress. Module checks pass; consult [the evidence log](odd/tasks/canvas-lan.md) for real-canvas, browser and second-device verification status. Native review is unavailable while managed assets require a sync that the user declined. This is not review approval.

## Quick setup

Requires Linux with Gentle Shell/Gentle Design and Node.js 22+. This package has no runtime dependencies beyond Node and its host.

Set the address once with the setup modal — a small centered window, not a full screen — persisted in `$XDG_CONFIG_HOME/gentle-canvas-lan/config.json` (default `~/.config/gentle-canvas-lan/config.json`) under the keys `ip`, `port` and `publicOrigin`:

```text
/canvas-lan:setup
```

It asks for the LAN host/IP, port (default `34316`) and an optional external HTTPS origin. `tab` (or the arrow keys) moves between fields, `enter` validates and saves, `esc` closes without changing anything; an invalid value is reported inside the window and the form stays open. Values survive Gentle Shell restarts. Environment variables still override saved values for one-off runs.

Load the local entry with your Pi/Gentle Shell launcher's `-e` option, for example:

```sh
pi -e /my-proyects/design-canvas-lan/extensions/canvas-lan.js
```

Alternatively, install this local directory with `pi install /my-proyects/design-canvas-lan` and reload the host. Installation changes host settings; it is a manual operator action, not performed by this repository or its tests.

Open a design with `/gentle:design` or the `gentle_design` tool. The extension starts lazily and shows the LAN address in its sidebar card or fallback widget. Automatic opens do not emit a redundant success notification; explicit start/status commands and errors still provide feedback. Open the complete LAN link on your laptop/phone; entering just the IP and port is insufficient because the token is required.

Successful `gentle_design` open/list results also include a text block with **Canvas LAN** only. Gentle Design's original local URL remains in its own content/details; this extension does not repeat it. The LAN link is available to the agent when composing its final response. This supplies both addresses; it does not rewrite or guarantee the model's final wording. No LAN link is added when the proxy is stopped or cannot start.

In compatible fullscreen Gentle Shell sessions, a **CANVAS LAN** card joins the sidebar through a guarded compatibility adapter. It uses semantic theme colors and contains only the LAN URL. The card header matches the native sections: plain `▾ CANVAS LAN` / `▸ CANVAS LAN` with the shell's own title styling, and the body row `- ▤ Open Design Canvas` carrying the document icon. A left click toggles the fold; state is session-only. The narrow fallback keeps its static `─ ▤ CANVAS LAN ───` heading and shows only the short URL text, because below-editor widgets are not a reliable mouse target here.

The card body shows `- ▤ Open Design Canvas` and a short stable LAN link (`http://LAN_IP:34316/s/<16-hex-capability>`) that redirects to the current tokenized canvas; no wrapped/truncated URL fragment is used as the click target. Use your terminal's link-opening modifier (often Ctrl+click) on that short link; it fits one line, survives canvas restarts, and redirects to the current canvas. `/canvas-lan:status` and the tool output still print the complete tokenized URL. The short path is a capability for your trusted LAN, like the canvas token itself: keep it private, and never expose this port publicly. The previous Status footer and its mouse handling are preserved, and the adapter restores it only while it still owns the slot.

This is a **private host contract**, not an official sidebar API. No installed files are modified or imported by absolute path. Host TUI helpers are imported at the extension entry and passed into the core installer, so native JavaScript dependencies do not bypass Pi's module aliases through a deferred import. If the host is incompatible, regular-mode, narrow/inactive, or a newer component replaces the adapter, the same LAN-only view falls back below the editor, with its title embedded in a thin `─ ▤ CANVAS LAN ───` rule above the link, using the active theme's border and text colors. Existing shell components may control visibility of their footer slot; not every shell preference is inherited by the add-on. A UI widget factory supplies TUI/theme and owns disposal; non-UI modes cannot display it. There is no extra stored conversation message. Stopping the proxy/canvas or shutting down the session removes the view; reopening a restarted canvas updates the link.

## Commands

| Command | Behavior |
| --- | --- |
| `/canvas-lan:setup` | Open a centered configuration modal for the bind IP, port and optional external origin; save them and rebuild the proxy. The `save` / `next` / `cancel` hints at the bottom are clickable, and `esc` cancels even on terminals that report extended key sequences. |
| `/canvas-lan:start` | Enable/start the fixed listener. It never advertises a link for a canvas that stopped answering: the card appears only while the registered canvas is alive. |
| `/canvas-lan:status` | Report the effective IP and port (env or saved), listener state and current LAN URL when available. It probes the registration first and retires a stale card. In the TUI the readout is appended to the transcript as a custom entry, so a later notification cannot replace it. |
| `/canvas-lan:stop` | Stop the listener and disable automatic restart until explicit start. |

The order in this table is the registration order, which is the order the host shows in its command menu: configure, start, inspect, stop.

Stopping the design canvas clears its registered target. Session shutdown closes the proxy and pending startup. A port conflict is reported without killing its owner or silently choosing another port. Independent sessions need distinct configured ports.

In the TUI, command feedback is transcript content: `/canvas-lan:start`, `/canvas-lan:stop`, `/canvas-lan:setup` results and errors are appended as custom entries (errors in the error color) instead of using the shell's single-slot status line, which the next info notification would erase. Non-TUI hosts keep using `notify`.

A registration is a claim, not a guarantee: `start` and `status` probe it once over HTTP before exposing a link, and revoke it when the local canvas no longer answers. While the port stays reserved without a live canvas, any request to the LAN address gets a short `text/html` page that says the canvas is not running and how to bring it back, instead of a bare `Bad Gateway`.

## Configuration and security

- `GENTLE_CANVAS_LAN_IP` is required: a concrete IP, not `0.0.0.0`, `::` or an automatically selected NIC. It was renamed from `GENTLE_CANVAS_LAN_HOST`, which is no longer read; `/canvas-lan:status` warns when the old variable is still exported.
- `GENTLE_CANVAS_LAN_PORT` defaults to `34316`.
- `GENTLE_CANVAS_LAN_PUBLIC_ORIGIN` optionally specifies an exact external HTTP/HTTPS origin (no trailing slash). Otherwise it is derived from the bind address and port.
- HTTP does not encrypt tokenized URLs, designs or comments. Use only a trusted network, restrict inbound access yourself, and never forward this port to the internet.
- Links are capabilities, **not read-only sharing**: users can send comments and implementation-related actions to the agent.
- Host/Origin/token are validated before proxy adaptation. Forwarded headers do not establish trust. No authentication, firewall changes or public tunnels are provided.
- Notification fallback depends on Gentle Design's current notice text; tool-result observation is the primary integration.
- Compare may reference an app at `localhost`, which means the viewing device. This extension does not expose or rewrite that app.
- Non-UI print/JSON modes do not show notifications. Use a TUI or RPC UI connection for URL reporting.

Details: [configuration](docs/configuration.md), [proxy](docs/proxy.md), [controller](docs/controller.md).

## Later HTTPS termination

For a reverse proxy on the same host, bind the extension to loopback and specify its external origin:

```sh
export GENTLE_CANVAS_LAN_IP=127.0.0.1
export GENTLE_CANVAS_LAN_PUBLIC_ORIGIN=https://canvas.example
```

Configure your reverse proxy to forward to `http://127.0.0.1:34316`, preserve the external Host and browser Origin, disable response buffering for SSE, and allow long-lived streams. Certificates and reverse-proxy configuration are operator-owned; this package serves HTTP only. For a reverse proxy on another LAN machine, use the server's LAN bind address and restrict it to that proxy with your firewall.

## Development and verification

```sh
npm test
```

Real installed-canvas checks are separate and need the local Gentle Shell installation path:

```sh
GENTLE_PI_ROOT=/absolute/path/to/gentle-pi npm run test:canvas
```

That integration command checks both the installed canvas server and the actual extension entry through Jiti with the host's `pi-tui` alias and disk caching disabled. It asserts that a TUI open mounts the component factory rather than the plain-string fallback. A further test runs the installed shell's actual sidebar layout and Pi frame renderer: initial/cached wide frames, narrow fallback and re-expansion must keep the LAN presentation visible. This uses a synthetic terminal/root, not a screenshot of your interactive session. It creates temporary fixture designs under excluded `.test-tmp/`. It does not modify installed sources, user designs, host settings or networking. Missing installation is an explicit error, not a silent skip.

After automated checks, manually verify from another LAN device: open a design, render its artboard/resources, add/send a fixture comment, observe live updates, restart the canvas and use its new link, confirm the old link fails, then stop the proxy and confirm the port is inaccessible. Do not run these against valuable designs or an agent session where fixture implementation requests would be undesirable.

## Project

[Implementation plan and evidence](odd/tasks/canvas-lan.md). Work is kept in local work-unit commits; no remote publishing configured. Package is private and unlicensed pending a licensing decision.

Inspired by [gentle-canvas-tailscale](https://github.com/BlazzzPlay/gentle-canvas-tailscale). The implementation uses direct trusted upstream registration instead of port scanning. The guarded sidebar integration is adapted from [mcp-sidebar](https://github.com/oniricosistemas/mcp-sidebar); see `THIRD_PARTY_NOTICES.md` for MIT attribution.
