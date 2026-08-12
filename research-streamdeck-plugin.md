# Stream Deck Plus Integration Research

## Conclusion

The integration is feasible with the generated TypeScript plugin and a small extension to DV Remote Dispatch.

The implemented first-pass design is:

1. DV Remote Dispatch exposes a versioned HTTP endpoint on its existing server and reports the controls of `PlayerManager.Car`.
2. One shared Stream Deck plugin service polls the small cached snapshot at 10 Hz.
3. The primary driving page contains throttle and brake encoders. A separate cab page contains the reverser and discrete cab controls, reducing the risk of changing direction accidentally while driving.
4. Dynamic brake, sanding, lights, wipers, horn, bell, and other cab controls follow after their locomotive-specific game APIs are understood.

The existing map and HTTP API continue to work without Stream Deck installed. The polling endpoint returns a pre-serialized cache and does not access Unity objects from its request thread, so one 10 Hz local client has negligible game overhead.

## What Already Exists

The mod already provides most of the locomotive telemetry needed in `ControllableLocoData`:

- Throttle, normalized from 0 to 1
- Independent brake, normalized from 0 to 1
- Train brake, normalized from 0 to 1
- Reverser
- Forward speed
- Brake-pipe pressure
- Wheel-slip state

It also has event-driven dirty tracking for throttle, independent brake, train brake, and reverser through `RemoteControllerModule.controlsOverrider`. This can be reused rather than polling every frame.

The existing HTTP control endpoint can set throttle, independent brake, and train brake. However, it requires a locomotive GUID and absolute values. A Stream Deck-specific control endpoint should target the player's current locomotive and accept relative steps.

Missing data:

- Player's current locomotive identity is not returned by the existing API, although the mod can access `PlayerManager.Car` directly.
- Dynamic-brake state is not included in `ControllableLocoData` or `RemoteControllerModule.controlsOverrider`.
- Sanding state and control are not included.

Dynamic brake and sanding therefore require a short in-game API discovery spike. The same applies to lights, wipers, horn, bell, and other cab controls. Different locomotive types may implement them differently, and unsupported controls must be reported explicitly rather than assumed to exist.

## Stream Deck Plus Capabilities

Each Plus dial and its 200 by 100 pixel quarter of the touch strip form an `Encoder` action. The SDK supports:

- `onDialRotate`, including signed tick count
- `onDialDown` and `onDialUp`
- `onTouchTap`, including normal versus held touch
- Dynamic text, icons, bars, gradients, and images through layouts and `setFeedback`
- Dynamic key titles/images and two-state keys

The plugin cannot draw one unrestricted 800-pixel-wide strip from a single action. Each of the four encoder slots owns its own 200 by 100 canvas. Four matching actions can still create a visually consistent full strip.

The plugin application layer runs as a local Node.js process. Its SDK WebSocket to the Stream Deck application is separate from application traffic. An independent WebSocket client was technically possible, but Derail Valley's Mono `HttpListener` rejected WebSocket upgrades in live testing. The integration therefore uses one shared HTTP polling service.

Elgato recommends no more than ten display updates per second. Control feedback should therefore be coalesced and rendered only when values change, with a ten-Hz maximum.

## Recommended User Experience

### Encoders

On the primary driving page, place the continuous power/brake controls under the four knobs:

| Encoder action | Rotate counterclockwise | Rotate clockwise | Touch-strip feedback |
| --- | --- | --- | --- |
| Throttle | One notch down | One notch up | `THR`, notch, bar |
| Independent brake | Decrease | Increase | `IND`, percentage/notch, bar |
| Train brake | Release | Apply | `TRN`, percentage/notch, bar |
| Dynamic brake (later) | Decrease | Increase | `DYN`, notch, bar |

Throttle should display its real discrete notch when the locomotive uses notches. Brake controls should initially show a rounded percentage unless game inspection reveals a stable locomotive-independent detent model. The throttle strip quarter should also show signed speed in km/h, for example `THR 5` with `42 km/h` below it.

Suggested custom layout per encoder:

- Short control name at the top
- Large value in the center
- High-contrast horizontal bar at the bottom
- Small disconnected or unsupported state when appropriate

The returned game state is authoritative. A dial rotation sends a command but does not optimistically alter the displayed value. This prevents drift if the game rejects a command, another input changes the control, or a locomotive has unusual notches.

Until dynamic-brake integration is implemented, the fourth encoder can retain its existing hotkey mapping or remain unused. The first plugin milestone only replaces throttle, independent brake, and train brake.

### Page Layout

Recommended Stream Deck Plus profile organization:

**Page 1: Driving**

- Encoder 1: throttle, with speed on the strip
- Encoder 2: independent brake
- Encoder 3: train brake
- Encoder 4: dynamic brake after its API is discovered; retain the current hotkey action initially
- Keys: frequently used, low-risk driving controls as desired

**Page 2: Cab**

- Reverser controls
- Sander
- Front and rear lights
- Wipers
- Horn and bell
- Starter, fuel cutoff, and other locomotive-specific controls

This makes an accidental reverser input less likely because it requires intentionally navigating to the cab page. Stream Deck profile pages own this organization; the plugin actions do not need to switch the whole device page themselves.

### Reverser Design

On the cab page, the recommended reverser control is an encoder:

- Clockwise moves one position toward forward.
- Counterclockwise moves one position toward reverse.
- The strip displays the authoritative current state as `REV`, `N`, or `FWD`.
- Pressing the encoder can set neutral as a convenient optional shortcut.
- Commands never jump directly from forward to reverse; each detent moves one position and the server validates the transition.

This is a direct representation of a three-position control, but the physical separation onto the cab page is the primary safety measure.

If keys are preferred, retain the existing two-key arrangement. Use the existing fixed `reverser-up.png` and `reverser-down.png` arrows, then dynamically set each key's title to the current transition, such as `N > F`, `F > N`, or `N > R`. Dim or disable the key at its endpoint. Six state-specific icons are not needed because the arrow communicates direction and the title communicates state. A single cycling key is not recommended because its effect is less predictable at a glance and reversing direction requires multiple presses.

### Deferred Sanding Key

After sanding state/control has been identified in the game API, provide a two-state `Sander` key action:

- Off: dark/gray icon and `SAND OFF`
- On: bright amber icon and `SAND ON`
- Plugin-controlled state with automatic state switching disabled
- Press sends a toggle command; game telemetry determines the displayed state

An optional later action can show wheel slip and flash when sanding may be useful.

### Connection States

Every action should clearly represent:

- Game/mod unavailable: `DV OFF` or disconnected icon
- Connected but player not in a locomotive: `NO LOCO`
- Control unsupported by current locomotive: `N/A`
- Connected and available: current value
- Command rejected: temporary Stream Deck alert plus a log entry

The plugin should reconnect with bounded exponential backoff after game restart, mod reload, machine sleep, or settings changes.

## Implemented Protocol

The plugin polls this versioned endpoint at 10 Hz:

```text
GET http://127.0.0.1:7245/api/streamdeck/v1
```

The endpoint returns a tiny pre-serialized snapshot captured on Unity's main thread. Request handling does not access Unity objects, so one local 10 Hz poll has negligible overhead. This uses the existing listener and port without another firewall rule or mod setting.

### Server to Plugin

Each poll returns a complete snapshot. The data is small enough that delta messages would add complexity without a useful performance benefit.

```json
{
  "type": "state",
  "protocol": 1,
  "locomotive": {
    "id": "L-001",
    "guid": "...",
    "controls": {
      "throttle": { "available": true, "value": 0.55, "notch": 5, "maxNotch": 9 },
      "independentBrake": { "available": true, "value": 0.2 },
      "trainBrake": { "available": true, "value": 0.35 },
      "reverser": { "available": true, "value": 0, "state": "neutral" }
    },
    "speedKph": 42.1
  }
}
```

When the player is not in a locomotive:

```json
{
  "type": "state",
  "protocol": 1,
  "locomotive": null
}
```

### Plugin to Server

Relative adjustments use a loopback-only HTTP POST because endless encoders naturally report signed ticks:

```text
POST http://127.0.0.1:7245/api/streamdeck/v1/adjust?control=throttle&steps=1
```

```json
{
  "type": "toggle",
  "requestId": "...",
  "control": "sander"
}
```

Optional absolute commands can be added later for touch gestures or other integrations:

```json
{
  "type": "set",
  "requestId": "...",
  "control": "trainBrake",
  "value": 0.5
}
```

The endpoint returns `204` on success and an error status when unavailable or invalid. The next polled snapshot remains authoritative.

## Security and Binding

The existing HTTP listener binds to `http://*:<port>/`, so the proposed endpoint may be reachable from the LAN. The first Stream Deck implementation should not silently bypass existing authentication or locomotive-control permissions.

Recommended first approach:

- The telemetry GET follows the existing server authentication behavior.
- The control POST accepts loopback clients only and applies server-side validation and clamping.
- Default the plugin endpoint to `127.0.0.1:7245`.
- Store endpoint and password in Stream Deck global settings, not per-action settings.

A later cleanup should consider a mod option to bind only to loopback when remote dispatch is not needed. That is broader than the Stream Deck feature and should be handled separately.

## Mod Design

Keep Stream Deck concepts out of the game-control layer. The mod should expose a small generic current-locomotive control API that other local integrations could also use.

Suggested boundaries:

- `CurrentLocoState`: obtains a snapshot for `PlayerManager.Car` on Unity's main thread.
- `CurrentLocoControl`: applies validated relative/absolute commands on Unity's main thread.
- `CurrentLocoTelemetry`: captures the serialized snapshot and applies validated relative controls.
- Existing `Updater`: captures telemetry on Unity's main thread at 10 Hz.
- Existing `HttpServer`: serves cached telemetry and marshals control commands to the main thread.

Important rules:

- Never access Unity objects from listener/background threads.
- Marshal state reads and writes through `Updater.RunOnMainThread`.
- Clamp every command server-side.
- Express unavailable controls as unavailable, especially across different locomotive types.
- Keep telemetry capture and client polling at no more than ten Hz.

## Plugin Design

Replace the generated counter with:

- One shared `DvConnection` service
- Initial encoder action classes: throttle, independent brake, and train brake
- Later encoder actions: dynamic brake on the driving page and reverser on the cab page
- Later key actions for sander and other cab controls after API discovery
- One shared property inspector for endpoint settings
- Custom encoder layout JSON and action images

For the initial private build, three explicit encoder actions are simpler and clearer than one configurable action. A configurable generic control action is more flexible for eventual distribution but adds property-inspector and validation work before the protocol is proven. Existing generated icons can seed these actions: `throttle.png`, `ind-brake.png`, and `trainbrake.png`. The existing reverser icons remain suitable when the cab page is implemented.

`DvConnection` responsibilities:

- Load global host, port, and credentials
- Maintain one polling loop regardless of how many actions are visible
- Validate protocol messages at runtime
- Cache the latest state
- Publish state and connection events to visible actions
- Queue/reject commands while disconnected rather than pretending they succeeded
- Recover automatically when the game or mod becomes available again
- Log protocol and connection errors without logging credentials

The scaffold currently claims macOS support. Derail Valley integration and the installed game paths are being developed on Windows, so the initial plugin manifest should advertise Windows only until macOS is actually tested.

## Phased Implementation

### Phase 0: Transport and Current-Locomotive Spike

Goal: prove only the infrastructure needed by controls whose data already exists.

1. Inspect `PlayerManager.Car` while entering and leaving locomotives.
2. Identify throttle/brake quantization for the first representative locomotive.
3. Verify reverser values and transitions (`-1`, `0`, `1`) for the first representative locomotive.
4. Test `HttpListener` WebSocket support inside the game's Mono runtime and select a fallback if needed.

Result: WebSocket upgrades failed under the game's Mono runtime, so the implementation selected cached HTTP polling. Current-locomotive snapshots were verified live.

### Phase 1: Read-Only Telemetry Prototype

Goal: prove end-to-end live feedback with minimal risk.

1. Add the versioned cached telemetry endpoint and complete state snapshots.
2. Implement the shared plugin connection service.
3. Implement three encoder actions, then replace the prototype layout with custom throttle/brake layouts.
4. Render throttle plus speed, independent brake, and train brake.
5. Handle disconnected and no-locomotive states.

Deliverable: live strip values while existing keyboard mappings still control the game. This isolates telemetry correctness from command behavior.

### Phase 2: Encoder Control

Goal: replace generic hotkey encoder actions.

1. Add relative `adjust` commands.
2. Map one physical detent to one game notch where possible.
3. Add server-side clamping, command results, and action alerts.
4. Verify switching locomotives and mixed locomotive types.
5. Replace built-in layouts with a polished shared custom layout.

Deliverable: three driving-page knobs both control and accurately display their game controls. The existing dynamic-brake hotkey remains in the fourth slot.

### Phase 3: Cab-Control Discovery and Cab Page

Goal: discover the missing game APIs, then replace the current sand hotkey first.

1. Find sanding read/write APIs and determine whether it is toggle, held, or latched per locomotive.
2. Find dynamic-brake, lights, wipers, horn, and bell APIs, recording differences by locomotive type.
3. Add reverser telemetry/control and place it on the second profile page.
4. Add sanding state telemetry and the plugin-controlled two-state key.
5. Add toggle or press/release semantics based on the discovery findings.
6. Test keyboard, cab control, and Stream Deck changes all update the actions.

Deliverable: a separate cab page with authoritative reverser and `SAND ON/OFF` feedback.

### Phase 4: Additional Cab Controls

Add dynamic brake, lights, wipers, horn, and bell incrementally. Each action should be implemented only after both its command semantics and authoritative state source are known. Unsupported controls should display `N/A` for the current locomotive.

### Phase 5: Hardening and Distribution

1. Add endpoint/password property inspector with global settings.
2. Add protocol version errors and reconnection tests.
3. Add an installable Stream Deck profile for Plus with the four encoders.
4. Validate and package with `streamdeck validate` and `streamdeck pack`.
5. Document compatible DV Remote Dispatch and plugin versions.
6. Decide whether to publish the plugin separately or include its package in mod releases.

## Testing Matrix

- Start Stream Deck before the game, and game before Stream Deck.
- Restart the game while the plugin remains running.
- Disable/re-enable the mod.
- Enter, leave, and switch locomotives.
- Test each supported locomotive family, initially for throttle/brake/reverser differences and later for additional cab controls.
- Change controls from keyboard, mouse/cab, and Stream Deck.
- Rotate encoders rapidly in both directions and at limits.
- Verify no drift between displayed and actual values.
- Verify a missing/incorrect password fails clearly.
- Verify no Stream Deck client leaves extra per-frame work in the mod.
- Verify unloading the world closes sockets and does not retain Unity objects.

## Decisions Recommended Now

- Use one shared 10 Hz HTTP polling service, not one request loop per action.
- Target `PlayerManager.Car`, not an arbitrary selected map locomotive.
- Use relative encoder commands and authoritative state feedback.
- Build three explicit encoder actions first: throttle, independent brake, and train brake.
- Keep reverser on a separate cab page rather than the primary driving page.
- Start with read-only telemetry before replacing working hotkeys.
- Show speed with throttle rather than consuming another action.
- Treat dynamic brake, sanding, lights, wipers, horn, and bell as discovery items, not assumptions.
- Keep the map client on its existing long-poll update path for now.

## Official References

- Getting started: https://docs.elgato.com/streamdeck/sdk/introduction/getting-started/
- Plugin environment: https://docs.elgato.com/streamdeck/sdk/introduction/plugin-environment/
- Dials and touch strip: https://docs.elgato.com/streamdeck/sdk/guides/dials/
- Touch-strip layouts: https://docs.elgato.com/streamdeck/sdk/references/touch-strip-layout/
- Keys and states: https://docs.elgato.com/streamdeck/sdk/guides/keys/
- Settings: https://docs.elgato.com/streamdeck/sdk/guides/settings/
- Manifest reference: https://docs.elgato.com/streamdeck/sdk/references/manifest/
- Packaging: https://docs.elgato.com/streamdeck/cli/commands/pack/
- .NET `HttpListenerContext.AcceptWebSocketAsync`: https://learn.microsoft.com/dotnet/api/system.net.httplistenercontext.acceptwebsocketasync?view=netstandard-2.0
