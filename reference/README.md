# Reference Materials

This directory contains SDK documentation, community repos, and code snippets for building Even Realities G2 apps.

## Structure

```
reference/
├── sdk/                        # Curated SDK & platform docs
│   ├── sdk-api-reference.md    # Even Hub SDK API surface
│   ├── sdk-capabilities.md     # What the SDK can/can't do
│   ├── cli-reference.md        # evenhub-cli commands
│   ├── hardware-constraints.md # G2 display/input limits
│   ├── development-patterns.md # Common patterns & best practices
│   ├── dev-workflow.md         # Dev loop: code → sim → test → ship
│   ├── integration-ideas.md    # App ideas & integration concepts
│   └── even-better-sdk-reference.md  # @jappyjan/even-better-sdk wrapper docs
│
├── community/                  # Cloned community repos (gitignored, clone locally)
│   ├── even-g2-notes/          # Community notes & reverse-engineering findings
│   ├── even-g2-protocol/       # BLE protocol documentation
│   ├── evenhub-templates/      # Official starter templates (minimal, asr, image, text-heavy)
│   ├── g2-kit-unofficial/      # Unofficial BLE transport + UI abstractions (Python/TS)
│   ├── even-dev/               # Simulator dev environment
│   └── weather-even-g2/        # Example: weather app for G2
│
├── snippets/                   # Standalone utility code
│   └── sendImageWithCenteredText.ts  # Canvas helper for G2 image containers
│
└── getting-started-tips.md     # Informal getting-started notes
```

## Refreshing Community Repos

Community repos are shallow clones for reference. To update:

```bash
cd reference/community/<repo> && git pull
```

To re-clone all:

```bash
cd reference/community
git clone --depth 1 https://github.com/nickustinov/even-g2-notes.git
git clone --depth 1 https://github.com/Commute773/g2-kit-unofficial.git
git clone --depth 1 https://github.com/i-soxi/even-g2-protocol.git
git clone --depth 1 https://github.com/even-realities/evenhub-templates.git
git clone --depth 1 https://github.com/BxNxM/even-dev.git
git clone --depth 1 https://github.com/nickustinov/weather-even-g2.git
```
