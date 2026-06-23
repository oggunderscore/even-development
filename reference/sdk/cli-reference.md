# EvenHub CLI Reference
> `@evenrealities/evenhub-cli` v0.1.12 — both `evenhub` and `eh` are valid command prefixes

## Install

```bash
npm install -g @evenrealities/evenhub-cli   # global
npm install -D @evenrealities/evenhub-cli   # per-project (use via npm scripts)
```

---

## Commands

### `evenhub login`
Authenticate with your Even Hub developer account.

```bash
evenhub login
evenhub login -e your@email.com
```

| Option | Description |
|--------|-------------|
| `-e`, `--email <email>` | Account email |

---

### `evenhub init`
Generate a starter `app.json` manifest.

```bash
evenhub init
evenhub init -d ./my-project
evenhub init -o ./config/app.json
```

| Option | Description |
|--------|-------------|
| `-d`, `--directory <dir>` | Target directory (default: `./`) |
| `-o`, `--output <path>` | Output file path |

---

### `evenhub qr`
Generate a sideload QR code. Scan with the Even Realities iPhone app for hot-reload dev.

```bash
evenhub qr --url "http://192.168.1.100:5173"
evenhub qr -i 192.168.1.100 -p 5173
evenhub qr --url "http://192.168.1.100:5173" -e   # open in external viewer
```

**Important:** use your machine's LAN IP, not `localhost` — the glasses connect over the network.

| Option | Description |
|--------|-------------|
| `-u`, `--url <url>` | Full URL |
| `-i`, `--ip <ip>` | IP address |
| `-p`, `--port <port>` | Port number |
| `--path <path>` | URL path segment |
| `--https` | Use HTTPS |
| `--http` | Use HTTP (default) |
| `-e`, `--external` | Open in external viewer |
| `-s`, `--scale <n>` | Scale factor for output (default: 4) |
| `--clear` | Reset cached settings |

---

### `evenhub pack`
Bundle the app into an `.ehpk` distribution package.

```bash
evenhub pack app.json dist -o evenpilot.ehpk
```

| Argument / Option | Description |
|-------------------|-------------|
| `<json>` | Path to `app.json` manifest |
| `<project>` | Path to build output directory |
| `-o`, `--output <file>` | Package filename (default: `out.ehpk`) |
| `--no-ignore` | Include hidden files |
| `-c`, `--check` | Verify package ID availability |

---

## Shell Completions

```bash
evenhub --completion-bash   # Bash
evenhub --completion-zsh    # Zsh
evenhub --completion-fish   # Fish
```
