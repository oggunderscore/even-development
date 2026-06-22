# Install Node.js & npm

*Install Node 20 LTS or 22+ on macOS, Windows, or Linux - the runtime Even Hub tooling depends on.*

Source: https://hub.evenrealities.com/docs/get-started/quickstart/install-node

> **Last updated:** 2026-06-08

Even Hub tooling runs on **Node.js**. Run `node -v`: if it reports **20.x or 22+**, jump to [Install Even Hub tooling](https://hub.evenrealities.com/docs/get-started/quickstart/install-tools). Otherwise, start here.

> **Target version:** **Node 20 LTS** or **22+**. The SDK declares `engines.node = "^20.0.0 || >=22.0.0"`. **Node 18 is not supported.**

## macOS - Homebrew

First install Homebrew if you don't have it:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then:

```bash
brew install node@22
```

## Windows - official installer

Download the **LTS** installer from [nodejs.org](https://nodejs.org) and run it. Accept the option to add Node to `PATH`.

## Linux - NodeSource

Distro packages are often outdated. Prefer NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

<details>

**Prefer a version manager? (fnm / nvm / winget)**
A version manager lets you switch Node versions per project and avoids global-permission headaches.

**macOS / Linux - fnm or nvm**

```bash
# fnm (fast)
curl -fsSL https://fnm.vercel.app/install | bash
# restart your shell, then:
fnm install 22
fnm use 22

# or nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 22
nvm use 22
```

**Windows - fnm or winget**

```powershell
# winget (ships with Windows 10/11)
winget install OpenJS.NodeJS.LTS

# or fnm via winget, then:
fnm install 22
fnm use 22
```

</details>

## Verify

```bash
node -v   # v20.x or v22.x+
npm -v
```

## Common gotchas

**macOS - PATH after Homebrew.** On Apple Silicon, Homebrew installs to `/opt/homebrew`. If `node` isn't found after install, ensure your shell profile sources it:

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
exec zsh
```

**Windows - shimmed `node.exe`.** Version managers (fnm/nvm-windows) expose `node` through a **shim**. This matters later: Windows Defender may block the shimmed `node.exe` inbound without prompting - see [Hardware → Network & Firewall Setup](https://hub.evenrealities.com/docs/get-started/quickstart/hardware#network-firewall-setup).

**Linux/macOS - `EACCES` on global installs.** If `npm install -g` fails with `EACCES`, **do not** `sudo npm`. Use a version manager (which installs into your home dir), or set a user-owned npm prefix:

```bash
npm config set prefix "$HOME/.npm-global"
export PATH="$HOME/.npm-global/bin:$PATH"   # add to your shell profile
```

**No global install? Use `npx`.** The CLI runs without a global install:

```bash
npx @evenrealities/evenhub-cli qr --url "http://<your-lan-ip>:5173"
```

Handy on locked-down machines. A global install is faster for repeated use.

