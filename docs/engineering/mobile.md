# Mobile development and device verification

The customer and rider directories contain notes only. No Expo package manifest, navigation, native build, device artifact or automated mobile runner exists. Product behavior is defined in the existing customer/delivery designs and [Dev 2 plan](../../dev2.md).

## Before creating an application

Confirm supported platforms and intended rider hardware. The product direction is a customer app for Android/iOS and an Android rider app, using React Native/Expo development builds. Native notifications, background location and local durable storage need early feasibility checks; browser previews cannot establish their behavior.

Do not invent Expo installation/start commands until manifests, selected versions and the development-build approach exist. Record public build configuration separately from server credentials and define secure session storage before implementing login.

## Required exploration before mobile UI test code

The supplied ARTEMIS instructions require observed device behavior before authoring tests. Runnable from repository root with Android platform-tools installed and a connected authorized device/emulator:

```powershell
adb devices -l
```

Expected: the intended device appears in `device` state. If more than one serial is available or selection is ambiguous, ask the user to choose before launching an ARTEMIS task. Use explicit serial targeting once chosen.

Explore actual screens, transitions, permissions and waiting states using ARTEMIS. Flash suits deterministic paths; Pro suits persistent plans, checkpoints and ADB/log diagnostics. Record the verified route, selectors, transient controls and device configuration before generating runnable test code.

## Test implementation

Inspect the chosen framework's locator capabilities. Prefer resource IDs, accessible text or other supported dynamic selectors. Where both mechanisms exist, use verified coordinate fallback after dynamic lookup failure. Parameterize coordinates where possible and document the screen size. A dynamic-only framework should use robust dynamic locators rather than invented coordinate APIs.

Use deterministic explicit waits in final scripts. Model latency during exploration is not an execution wait strategy. Verify background, locked-screen, denied-permission, killed-process and reconnect behavior on representative hardware for the capabilities that require them.

## ARTEMIS failures

Call `mobile_diagnose` before retrying a failed task or guessing about device access. Use `attempt_fix=true` before asking for manual ADB intervention and follow its dependency-ordered steps. Credentials belong in the reported local configuration path, never chat.

If the diagnosis tool is absent, inspect the IDE MCP server log and use `uv run artemis doctor` in the ARTEMIS project directory, not automatically this repository. That directory and CLI installation must first be identified. Reload the MCP server after configuration changes. Do not start an emulator as a foreground shell process.

## Evidence boundaries

Record serial/model, OS, application build, network/permission state, steps and observed results. Pull diagnostic artifacts with explicit serial-targeted ADB commands when needed, keeping secrets out of reports. Android results do not verify iOS. No ARTEMIS or device exploration was performed for this documentation work because no mobile tests are being authored.
