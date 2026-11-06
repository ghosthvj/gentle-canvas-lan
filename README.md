# Gentle Canvas LAN

A planned Gentle Shell extension to access the Gentle Design canvas from a laptop or phone on a trusted LAN, while Gentle Shell runs on a headless Linux host.

**Status: repository bootstrap and implementation plan only. No working extension or proxy is included yet.**

## Intended behavior

```text
http://LAN_IP:34316/<current-token>/
  -> LAN proxy on a fixed port
  -> http://127.0.0.1:<dynamic-canvas-port>/<current-token>/
```

The extension will learn the current local URL from Gentle Design and update its upstream when the canvas restarts. The LAN port stays fixed; the URL token can change. Tailscale will not be required.

Initial transport is HTTP on a trusted LAN. A later LAN reverse proxy may terminate HTTPS using an explicitly configured public origin.

## Implementation plan

See [the task document](odd/tasks/canvas-lan.md) for the requirements, proposed configuration, implementation units, test strategy and commit boundaries.

1. Validate configuration and register the current loopback canvas URL.
2. Implement a guarded HTTP proxy, including streaming updates.
3. Handle startup, shutdown and dynamic canvas restarts safely.
4. Integrate Gentle Shell commands, tool events and notifications.
5. Verify the real canvas and document LAN operation.

## Development baseline

- Node.js 22 or later; npm and Git.
- ES modules; planned tests use Node's built-in test runner.
- No dependencies, install scripts, extension entry or functional tests yet.
- The package is private and unlicensed pending a project licensing decision.
- Local work happens on `feat/canvas-lan`; no remote is configured.

## Important limits

- HTTP does not encrypt the token or design content. Use only a trusted network and restrict network access appropriately.
- A canvas link is not read-only: canvas actions may send comments or implementation requests to the agent.
- The Compare view may reference an app at `localhost`; exposing the canvas does not automatically expose that app to another device.
- No installation, firewall changes or listening services are performed by this bootstrap.

## Inspiration

[gentle-canvas-tailscale](https://github.com/BlazzzPlay/gentle-canvas-tailscale) demonstrates a loopback canvas proxy. This project plans a LAN-native implementation with direct upstream registration, explicit origin validation and safer lifecycle handling. No upstream code has been copied at this stage.
