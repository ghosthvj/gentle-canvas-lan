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

Set the address assigned to your Linux server **before launching Gentle Shell**:

```sh
export GENTLE_CANVAS_LAN_HOST=192.168.1.20
export GENTLE_CANVAS_LAN_PORT=34316
```

Load the local entry with your Pi/Gentle Shell launcher's `-e` option, for example:

```sh
pi -e /my-proyects/design-canvas-lan/extensions/canvas-lan.js
```

Alternatively, install this local directory with `pi install /my-proyects/design-canvas-lan` and reload the host. Installation changes host settings; it is a manual operator action, not performed by this repository or its tests.

Open a design with `/gentle:design` or the `gentle_design` tool. The extension starts lazily and reports `Canvas LAN: http://...`. Open that complete link on your laptop/phone; entering just the IP and port is insufficient because the token is required.

Successful `gentle_design` open/list results also include a text block with **Canvas Local** and **Canvas LAN**. Both links are available to the agent when composing its final response: Local is for tools/browser checks on the server, LAN is for your other devices. The original tool content and details remain unchanged. This supplies both addresses; it does not rewrite or guarantee the model's final wording. No LAN link is added when the proxy is stopped or cannot start.

In a UI session, a persistent **Canvas Local / Canvas LAN** widget is also shown below the editor and refreshed when the agent settles. It remains visible independently of further tool calls or what the final assistant response says. This is a UI block, not text inserted into the assistant's reply or an extra stored conversation message. Stopping the proxy/canvas or shutting down the session clears it; a restarted canvas updates both links. The target frontend must support Pi's `setWidget` API; non-UI modes cannot display it.

## Commands

| Command | Behavior |
| --- | --- |
| `/canvas:lan` or `/canvas:lan start` | Enable/start the fixed listener. Without a canvas registration, requests return 502 until you open a design. |
| `/canvas:lan status` | Report listener state and current LAN URL when available. |
| `/canvas:lan stop` | Stop the listener and disable automatic restart until explicit start. |

Stopping the design canvas clears its registered target. Session shutdown closes the proxy and pending startup. A port conflict is reported without killing its owner or silently choosing another port. Independent sessions need distinct configured ports.

## Configuration and security

- `GENTLE_CANVAS_LAN_HOST` is required: a concrete IP, not `0.0.0.0`, `::` or an automatically selected NIC.
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
export GENTLE_CANVAS_LAN_HOST=127.0.0.1
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

That integration command uses the installation's jiti loader with disk caching disabled and creates temporary fixture designs under excluded `.test-tmp/`. It does not modify installed sources, user designs, host settings or networking. Missing installation is an explicit error, not a silent skip.

After automated checks, manually verify from another LAN device: open a design, render its artboard/resources, add/send a fixture comment, observe live updates, restart the canvas and use its new link, confirm the old link fails, then stop the proxy and confirm the port is inaccessible. Do not run these against valuable designs or an agent session where fixture implementation requests would be undesirable.

## Project

[Implementation plan and evidence](odd/tasks/canvas-lan.md). Work is kept in local work-unit commits; no remote publishing configured. Package is private and unlicensed pending a licensing decision.

Inspired by [gentle-canvas-tailscale](https://github.com/BlazzzPlay/gentle-canvas-tailscale). The implementation uses direct trusted upstream registration instead of port scanning. No upstream source was copied.
