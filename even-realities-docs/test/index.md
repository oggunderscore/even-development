# Test

*Four ways to run your app - simulator, local QR sideload, private build, beta build - and which one each gate demands.*

Source: https://hub.evenrealities.com/docs/test/

> **Last updated:** 2026-06-11

Four ways to run an Even Hub app. They differ in speed, fidelity, and what actually works. **Beta Testing** is what the QA gate demands; the first two are where day-to-day iteration happens.

| Mode | Hardware | Iteration | Hot reload | Survives lock | Real `.ehpk` | Reviewer parity |
| --- | --- | --- | --- | --- | --- | --- |
| **[Simulator](https://hub.evenrealities.com/docs/test/simulator)** | No | Instant | n/a | n/a | No | No |
| **[Local Testing](https://hub.evenrealities.com/docs/test/local-testing)** | Yes | < 1 s | **Yes** | No | No | No |
| **[Private Testing](https://hub.evenrealities.com/docs/test/private-testing)** | Yes | ~10 s | No | Partial | **Yes** | Closer |
| **[Beta Testing](https://hub.evenrealities.com/docs/test/beta-testing)** | Yes | ~30 s | No | **Yes** | **Yes** | **Yes** |

- **[Simulator](https://hub.evenrealities.com/docs/test/simulator)** - desktop sim renders the glasses canvas; optional HTTP automation API for scripted tests

- **[Local Testing](https://hub.evenrealities.com/docs/test/local-testing)** - dev server + QR sideload; hot module reload over BLE; the daily driver

- **[Private Testing](https://hub.evenrealities.com/docs/test/private-testing)** - first time the real `.ehpk` packaging path runs; not headless yet

- **[Beta Testing](https://hub.evenrealities.com/docs/test/beta-testing)** - distribute to yourself as a beta tester; the only mode that matches what a reviewer sees

