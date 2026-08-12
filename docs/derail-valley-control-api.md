# Derail Valley Locomotive Control API Reference

This document records reusable findings for reading and controlling locomotive cab systems from a Derail Valley mod. It is intended to reduce repeated assembly research when adding future integrations.

Research target:

- Derail Valley Build 99, build 2702
- `Assembly-CSharp.dll` and `DV.Simulation.dll`
- Findings verified by decompilation; prefab-specific details still require live testing

## Canonical Access

Start with the locomotive `TrainCar`:

```csharp
TrainCar? car = PlayerManager.Car;
BaseControlsOverrider? controls = car?.SimController?.controlsOverrider;
```

Relevant namespaces:

```csharp
using DV.Simulation.Cars;
using DV.Simulation.Controllers;
```

`BaseControlsOverrider` exposes nullable properties for generic controls:

```csharp
controls.Throttle
controls.Brake
controls.IndependentBrake
controls.DynamicBrake
controls.Reverser
controls.Sander
controls.Horn
controls.HeadlightsFront
controls.HeadlightsRear
controls.Starter
controls.PowerOff
controls.CabLight
controls.Wipers
```

A null property means that locomotive does not provide that generic control. Do not assume every locomotive implements every property.

Generic lookup is also available:

```csharp
controls.GetControl(InteriorControlsManager.ControlType.DynamicBrake);
controls.GetValue(InteriorControlsManager.ControlType.DynamicBrake, defaultValue);
```

The strongly typed properties are simpler when the set of controls is known.

## Common Control API

The target controls derive from `OverridableBaseControl`:

```csharp
float Value
bool IsNotched
float NotchCount
bool IsControlBlocked
event Action<float> ControlUpdated
void Set(float value)
void Move(float notches)
```

### Reading

`Value` is the normalized command-port value, normally in `0..1`. It is the requested control position, not necessarily the effective output after fuses, damage, resource depletion, or other simulation rules.

`IsNotched` and `NotchCount` are populated from the matching cab `ControlSpec` when available. The metadata can vary between locomotive prefabs.

### Absolute Writes

`Set(value)` clamps to `0..1` and respects `IsControlBlocked`. A blocked write is silently ignored, so read the authoritative value afterward rather than assuming success.

### Relative Writes

`Move(+1)` or `Move(-1)` is the preferred generic operation for a Stream Deck encoder:

- If the physical interior control is loaded, `Move` asks `InteriorControlsManager` to move it by an integer number of detents. This respects reversed scroll directions and updates the visible cab control.
- Without an interior scrollable, a notched control changes by `notches / NotchCount`.
- Without an interior scrollable, a continuous control changes by the supplied normalized amount. Calling `Move(1)` on a non-notched control would jump to an endpoint, so use a chosen absolute increment with `Set` for continuous controls.
- Fractional `Move` values are truncated when routed through a loaded physical control. Use integer detents.

### Events

`ControlUpdated` fires when the underlying command port changes. It can drive event-based dirty tracking. A simple integration may instead capture all required values on Unity's main thread at 10 Hz and serve a cached snapshot.

### Main-Thread Rule

Read and write Unity/game objects only on Unity's main thread. HTTP or socket request threads should consume cached serialized state and marshal writes through `Updater.RunOnMainThread`.

## Existing Remote Interface

`DV.RemoteControls.RemoteControllerModule` implements `ILocomotiveRemoteControl` and already provides several useful methods:

```csharp
GetTargetThrottle()
GetTargetBrake()
GetTargetIndependentBrake()
GetReverserValue()
GetReverserSymbol()
IsSandOn()
UpdateThrottle(float factor)
UpdateBrake(float factor)
UpdateIndependentBrake(float factor)
UpdateReverser(ToggleDirection toggle)
UpdateSand(ToggleDirection toggle)
UpdateHorn(float value)
```

`RemoteControllerModule` calculates throttle and brake increments from the control's native notch metadata. Its train-brake behavior also handles non-self-lapping brakes specially. Prefer these methods when their semantics match the integration. Use `BaseControlsOverrider` for controls not exposed by `ILocomotiveRemoteControl`.

## Target Controls

### Dynamic Brake

Type:

```csharp
DV.Simulation.Controllers.DynamicBrakeControl
```

Access:

```csharp
DynamicBrakeControl? dynamicBrake = controls?.DynamicBrake;
```

Use the common `Value`, `IsNotched`, `NotchCount`, `Move`, and `Set` APIs. Null indicates that the current locomotive has no generic dynamic-brake control.

Important considerations:

- Native notch count is prefab-specific.
- A `ControlBlocker` may reject dynamic-brake changes based on locomotive operating conditions.
- Dynamic brake participates in multiple-unit propagation.
- Combined throttle/dynamic-brake handles may impose additional physical-control behavior. Test each supported locomotive family.

Recommended Stream Deck design:

- Encoder on the primary driving page.
- Rotate by one native detent using `Move(Math.Sign(ticks))`.
- Display native position or normalized percentage and a bar.
- Show `N/A` when unavailable.

Live verification on locomotive `L-062` confirmed an eight-notch dynamic brake. One encoder rotation event moves one native detent and the normalized percentage display tracks the cab control.

### Sander

Types:

```csharp
DV.Simulation.Controllers.SanderControl
LocoSim.Implementations.Sander
```

Access:

```csharp
SanderControl? sander = controls?.Sander;
bool commandedOn = (sander?.Value ?? 0f) > 0f;
```

`ILocomotiveRemoteControl.IsSandOn()` and `UpdateSand(ToggleDirection)` are also available.

The simulation accepts a continuous `0..1` command. Some locomotive controls provide off/light/heavy detents, while others provide only off/on. Effective flow also depends on remaining sand and an optional fuse, and is smoothed over approximately 0.5 seconds.

Standard Stream Deck design:

- Use one toggle key, not an encoder.
- If the authoritative command is off, press sets `sander.Set(1f)`.
- If the authoritative command is on, press sets `sander.Set(0f)`.
- Render active feedback with distinct on/off images; text is unnecessary.
- This intentionally requests maximum sanding on both two-position and three-position locomotives.

Optional advanced action:

- A `Sander Level` encoder can use native detents for off/light/heavy.
- Do not require it in the default profile because sanding does not justify a dedicated knob for most users.

The generic command value does not prove that sand is physically flowing. Empty sand or a disabled fuse can result in no effective sanding while the command remains on. Effective flow exists in the internal `SAND_FLOW` readout but needs additional simulation-port access if that distinction becomes important.

### Front and Rear Headlights

Types:

```csharp
DV.Simulation.Controllers.HeadlightsControlFront
DV.Simulation.Controllers.HeadlightsControlRear
DV.Simulation.Cars.HeadlightsMainController
```

Access:

```csharp
HeadlightsControlFront? front = controls?.HeadlightsFront;
HeadlightsControlRear? rear = controls?.HeadlightsRear;
HeadlightsMainController? controller = car?.SimController?.headlightsController;
```

Critical semantics:

- The canonical neutral/off command is `0.4`, not `0`.
- `HeadlightsControlBase.NEUTRAL_VALUE` is `0.4f`.
- Values below and above `0.4` select direction-dependent lighting configurations.
- The number of configurations is locomotive-specific.

Useful setup methods:

```csharp
controller.GetSetupCount(front: true)
controller.GetSetupCount(front: false)
controller.GetOffIndex(front: true)
controller.GetOffIndex(front: false)
controller.GetPortValues()
```

The setup index is effectively:

```csharp
Mathf.RoundToInt(controlValue * (setupCount - 1))
```

Prefer `Move(+1/-1)` for encoder control so actual prefab detents and reversed directions are respected. Do not implement an off button as `Set(0)`; use `Set(0.4f)` or the calculated off index/value.

Commanded state can differ from visible output due to:

- Power fuse state
- Headlight damage
- Automatic-headlight difficulty preferences
- Brake-hose and MU connections
- Reversed locomotive orientation in a multiple unit
- Light optimization at distance

Front and rear headlight controls participate in MU propagation. Reversed MU orientation may swap front and rear behavior.

Live verification on locomotive `L-062` confirmed six positions for both front and rear controls:

```text
0: red running lights, position 1
1: red running lights, position 2
2: off
3: white running lights
4: headlights
5: high beams
```

The off position reports normalized value `0.4`, consistent with `NEUTRAL_VALUE`.

Recommended Stream Deck design:

- Separate front and rear encoders on the cab page.
- Rotate through native configurations.
- Display `RED 1`, `RED 2`, `OFF`, `RUNNING`, `HEADLIGHT`, and `HIGH BEAM` for the confirmed six-position controls. Fall back to a numeric position for an unknown configuration count.
- Press may return to neutral/off, using `0.4`, after live testing.

### Wipers

Types:

```csharp
DV.Simulation.Controllers.WipersControl
DV.Rain.WipersSimControlInput
DV.Rain.WiperController
```

Access:

```csharp
WipersControl? wipers = controls?.Wipers;
WipersSimControlInput? input = car?.SimController?.wipersController;
WiperController? controller = input?.wiperController;
```

The effective position is calculated as:

```csharp
Mathf.RoundToInt(controlValue * (controller.speeds.Length - 1))
```

Default `WiperController` arrays describe four positions:

```text
0: off
1: intermittent
2: continuous normal
3: continuous fast
```

Live verification on locomotive `L-062` confirmed these four positions and labels. Encoder movement advances one position at a time.

Prefab arrays may differ. Use `controller.speeds.Length` as the effective setting count rather than assuming four positions or relying only on `WipersControl.NotchCount`.

Useful runtime fields:

```csharp
controller.speeds
controller.timeBetweenWipes
controller.speedIndex
controller.usedSpeedIndex
```

A disabled optional fuse forces effective speed to zero without changing the requested control `Value`. Wipers are local and do not participate in MU propagation.

Recommended Stream Deck design:

- Encoder on the cab page.
- Move one position per rotation event.
- Display `OFF`, `INT`, `ON`, or `FAST` when four positions are confirmed; otherwise display a numeric position.
- Press may set `0` for off.

## Multiple-Unit Behavior

Dynamic brake, sander, and front/rear headlights can propagate through multiple-unit connections. Headlight direction can swap when units are reversed. Wipers are local to the cab.

Use normal `Set`/`Move` for player controls. `MUOverride` is intended for the game's propagation machinery and should not be the default integration write path.

## Availability and Telemetry Shape

A generic API response should report both availability and normalized value:

```json
{
  "dynamicBrake": {
    "available": true,
    "value": 0.5,
    "isNotched": true,
    "notchCount": 9
  },
  "sander": {
    "available": true,
    "value": 0
  },
  "headlightsFront": {
    "available": true,
    "value": 0.4,
    "position": 2,
    "positionCount": 6
  },
  "wipers": {
    "available": true,
    "value": 0,
    "position": 0,
    "positionCount": 4
  }
}
```

Do not substitute zero for unavailable controls; clients need to distinguish `N/A` from a valid off position.

## Live Verification Checklist

For each locomotive family or livery:

1. Record which `BaseControlsOverrider` properties are null.
2. Record `Value`, `IsNotched`, `NotchCount`, and `IsControlBlocked`.
3. Exercise `Move(+1)` and `Move(-1)` with the interior loaded.
4. Confirm displayed/physical controls remain synchronized.
5. Test dynamic-brake blockers and combined-handle behavior.
6. Hold and release maximum sanding; verify command feedback and actual sand consumption.
7. Enumerate front/rear headlight setup counts and verify the `0.4` off position.
8. Test headlights with fuses, damage, hoses, MU cables, and reversed unit orientation.
9. Enumerate wiper speed arrays and verify requested versus effective speed with the fuse disabled.
10. Repeat after entering a different locomotive without restarting the mod or Stream Deck plugin.

## Decompilation Commands

An `ilspycmd` local tool can inspect individual types without adding a project dependency:

```powershell
ilspycmd -t "DV.Simulation.Cars.BaseControlsOverrider" `
  -r "<DerailValley_Data\Managed>" `
  "<DerailValley_Data\Managed\Assembly-CSharp.dll>"
```

Useful starting types:

- `DV.Simulation.Cars.BaseControlsOverrider`
- `DV.Simulation.Controllers.OverridableBaseControl`
- `DV.RemoteControls.RemoteControllerModule`
- `ILocomotiveRemoteControl`
- `DV.Simulation.Cars.SimController`
- `DV.Simulation.Cars.HeadlightsMainController`
- `DV.Rain.WipersSimControlInput`
- `DV.Rain.WiperController`
- `LocoSim.Implementations.Sander`
