# Hardware

*Pair your G2 and R1, enable Developer Mode in the phone app, and clear the firewall / Wi-Fi obstacles between your laptop and the glasses.*

Source: https://hub.evenrealities.com/docs/get-started/quickstart/hardware

> **Last updated:** 2026-06-04

You can build a lot in the simulator alone, but the rest of the docs assume your glasses are paired and on current firmware. This page gets you there - hardware setup, Developer Mode, and the firewall / Wi-Fi gotchas that QR sideloading runs into.

## Set up your G2 & R1

If you only have the simulator for now, jump to [Your First App](https://hub.evenrealities.com/docs/get-started/quickstart/first-app) and come back once the glasses arrive.

### Naming convention

Throughout the docs and the phone app:

- **Even G2** - the glasses.

- **Even R1** - the optional input ring.

Your devices appear under these names in the Bluetooth pairing list.

### Exit shipping mode

New glasses arrive in **shipping mode** - battery isolated so they don't drain in transit. They look dead out of the box. Wake them:

1. Drop both arms into the **charging case** and close it.

2. Watch the **case light**: 
  - **White** - charged and ready.

  - **Orange (≈3 s)** - seating feedback when you insert the glasses.

3. Open the case. The glasses are now powered and discoverable.

### Pairing

1. Open the **Even Realities App** and sign in.

2. Go to **Devices → Add device** and select **Even G2**.

3. Confirm the pairing prompt. The glasses display a brief confirmation.

### Firmware update

The app checks for firmware right after pairing. **Take the update before doing anything else** - most early connection failures trace back to stale firmware.

1. The app prompts when an update is available, or check **Devices → Firmware** manually.

2. Keep the glasses in the case and the phone nearby until the flash finishes.

3. Don't interrupt it.

### Pair the R1 ring (optional)

The R1 adds a touchpad you can use without raising a hand to your temple.

1. In the app, go to **Devices → Add device → Even R1**.

2. Follow the same confirm-prompt flow as the glasses.

The R1 gesture and event model lives in [Device APIs → Inputs](https://hub.evenrealities.com/docs/build/device-apis#inputs).

## Enable Developer Mode

There is **no toggle**. Signing in to the web hub flips your account to developer; the next restart of the phone app surfaces the developer section.

### 1. Sign in to the web hub

Log in at **[hub.evenrealities.com/login](https://hub.evenrealities.com/login)** with the same account you registered in the phone app. See [Sign in](https://hub.evenrealities.com/docs/get-started/quickstart/sign-in) for the full flow.

### 2. Restart the Even Realities App

Force-quit the app - swipe it away from recents, not just background - and reopen it.

### 3. Check the Even Hub tab

A **developer section** appears in the **top-right of the Even Hub tab**. That's where the **Scan QR** button lives, alongside the rest of the dev features [Your First App](https://hub.evenrealities.com/docs/get-started/quickstart/first-app) uses.

### Known issue: manual Link jump in Dev Preview

In **Dev Preview**, a manually triggered Link jump may fail - no response, the wrong page, or a bounce to the home screen. The mobile team is on it. Workaround: re-scan the QR instead of relying on in-app Link navigation. This page updates once the fix ships.

## Network & Firewall Setup

**If QR sideloading already works, skip this section.** What follows is for the case where the QR scans but the app never loads.

QR sideloading points the phone at a dev server on **your laptop** (`http://192.168.1.100:5173` or similar). For that to work, the phone and laptop have to be on the same network with nothing silently dropping the connection between them - the single most common reason the QR scans and nothing happens.

### 1. Find your LAN IP

You need your laptop's address on the local network - not `localhost`.

```bash
# macOS
ipconfig getifaddr en0        # Wi-Fi; try en1 if blank

# Linux
hostname -I | awk '{print $1}'

# Windows (PowerShell)
ipconfig | findstr /i "IPv4"
```

Use that address in the QR URL:

```bash
evenhub qr --url "http://<your-lan-ip>:5173"
```

### 2. Allow Node through the firewall

#### macOS - Application Firewall

macOS silently drops the first inbound phone-to-laptop connection. Allow Node explicitly:

1. **System Settings → Network → Firewall → Options…**

2. Add your **node** binary and set it to **Allow incoming connections**.

3. To confirm the firewall is the culprit, toggle it off, retry, then re-enable with the allow rule in place.

> **TIP**
>
> With a version manager, the `node` binary lives under `~/.fnm/...` or `~/.nvm/...`. Add **that** path - not a stale `/usr/local/bin/node`.

#### Windows Defender

Defender often blocks `node.exe` inbound **without prompting**, especially the shimmed `node.exe` from fnm/nvm-windows. Add an inbound rule on the dev port:

1. **Windows Security → Firewall & network protection → Advanced settings**.

2. **Inbound Rules → New Rule → Port → TCP → 5173** (or your dev port) → **Allow**.

3. Apply to the **Private** profile at minimum.

### 3. Wi-Fi AP isolation

Corporate Wi-Fi and a lot of home routers ship with **AP / client isolation** on. It blocks device-to-device traffic even on the same SSID. The symptom: ping and connection silently fail with the firewall already open.

Fallbacks, in order of convenience:

| Fallback | How |
| --- | --- |
| **Phone hotspot** | Tether the laptop to the phone's hotspot; both are then on the phone's network with no isolation. |
| **Different network** | Use a home/guest network without client isolation. |
| **Tailscale** | Put phone and laptop on the same [Tailscale](https://tailscale.com) tailnet and use the Tailscale IP in the QR URL. |

### Quick diagnosis

If the QR scans but the app never loads, work this list top-down.

| Step | Check | If it fails |
| --- | --- | --- |
| 1 | Open `http://<your-lan-ip>:5173` in your **phone's** browser | Phone can't reach the laptop - go to step 2 |
| 2 | Confirm the dev server is actually running (`npm run dev` shows `Local:` line) | Restart the dev server, re-generate the QR |
| 3 | Confirm the IP in the QR matches the laptop's current LAN IP (Wi-Fi networks reassign on reconnect) | Re-run `evenhub qr --url "http://<current-ip>:5173"` |
| 4 | macOS / Windows firewall allowing Node / port 5173? (see [step 2 above](#_2-allow-node-through-the-firewall)) | Add the allow rule, retry step 1 |
| 5 | Router has AP / client isolation enabled? (see [step 3 above](#_3-wi-fi-ap-isolation)) | Fall back to phone hotspot or Tailscale |

## Next

[Your First App](https://hub.evenrealities.com/docs/get-started/quickstart/first-app) - scaffold, run, and sideload via QR.

