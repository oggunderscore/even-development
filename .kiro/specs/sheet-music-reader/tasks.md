# Implementation Plan: Sheet Music Reader

## Overview

Implement the Sheet Music Reader application for Even Realities G2 AR glasses. The app imports MusicXML and MIDI files, renders sheet music as 4-bit greyscale image tiles, and auto-scrolls at tempo-synchronized rates. The implementation follows the pipeline: Import → Parse → Render → Tile → Display → Scroll, with a finite state machine governing scroll behavior.

## Tasks

- [ ] 1. Set up project structure, dependencies, and core data models
  - [ ] 1.1 Create project structure with directories (`src/import`, `src/render`, `src/core`, `src/display`, `src/library`, `src/config`, `src/__tests__`) and configure `package.json` with dependencies: `vexflow`, `musicxml-interfaces`, `@tonejs/midi`, `jszip`; dev dependencies: `vitest`, `fast-check`, `typescript`; configure `tsconfig.json`
    - _Requirements: 7.1, 7.3_
  - [ ] 1.2 Create core data model interfaces in `src/models/score.ts`: `Score`, `TimeSignature`, `Measure`, `NoteEvent`, `Pitch`, `Duration`, `AppState`, `AppConfig`, and `LibraryEntry` types as specified in the design
    - _Requirements: 1.1, 1.2, 9.1_
  - [ ] 1.3 Create application event types in `src/models/events.ts`: `AppEvent` union type, `ScrollState` enum, `ParseResult<T>` type, and `ValidationResult` interface
    - _Requirements: 3.1, 3.2, 3.5, 3.6_

- [ ] 2. Implement file validation and import parsers
  - [ ] 2.1 Implement `validateImportFile` in `src/import/validator.ts` — accept `.musicxml`, `.mxl`, `.mid` extensions; reject files > 10 MB; return descriptive error messages for rejected files
    - _Requirements: 1.3, 1.9_
  - [ ]* 2.2 Write property test for file validation (Property 3: Invalid File Extension Rejection)
    - **Property 3: Invalid File Extension Rejection**
    - **Validates: Requirements 1.3**
    - Generate random filenames without valid extensions; assert all return invalid with non-empty error
  - [ ] 2.3 Implement `parseMusicXML` in `src/import/musicxml-parser.ts` — parse MusicXML/MXL files into Score model, extracting notes, rests, measure boundaries, tempo (default 120 BPM), time signature (default 4/4); handle compressed `.mxl` via JSZip
    - _Requirements: 1.1, 1.5, 1.6, 1.7, 1.8_
  - [ ] 2.4 Implement `parseMidi` in `src/import/midi-parser.ts` — convert MIDI note-on/note-off pairs into Score model with pitched notes, durations, rests, measure boundaries from time signature meta-events, tempo from tempo meta-events (default 120 BPM if missing)
    - _Requirements: 1.2, 1.5, 1.6, 1.7, 1.8_
  - [ ] 2.5 Implement `parseFile` in `src/import/parser-router.ts` — route validated files to correct parser based on extension
    - _Requirements: 1.1, 1.2_
  - [ ]* 2.6 Write property tests for parsers (Properties 1, 2, 4: Parsing Round-Trip and Malformed Rejection)
    - **Property 1: MusicXML Parsing Round-Trip**
    - **Property 2: MIDI Parsing Round-Trip**
    - **Property 4: Malformed Data Rejection Preserves State**
    - **Validates: Requirements 1.1, 1.2, 1.4, 1.5, 1.7**
    - Use `fast-check` generators for valid MusicXML, valid MIDI, and malformed byte arrays

- [ ] 3. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement score rendering pipeline
  - [ ] 4.1 Implement `rgbaToGreyscale4bit` in `src/render/quantizer.ts` — convert RGBA pixel data to 4-bit greyscale using luminance formula: `Math.round((0.299*R + 0.587*G + 0.114*B) * (A/255) * 15 / 255)`
    - _Requirements: 2.2_
  - [ ] 4.2 Implement `sliceIntoTiles` in `src/render/tile-slicer.ts` — divide rendered pixel strip into tiles no larger than 288×144 px each
    - _Requirements: 2.3_
  - [ ] 4.3 Implement `renderScore` in `src/render/renderer.ts` — use VexFlow to render Score onto offscreen canvas, produce horizontal strip, slice into tiles via tile-slicer, quantize via quantizer; handle single and dual staves with proportional vertical allocation
    - _Requirements: 2.1, 2.2, 2.3, 2.5_
  - [ ]* 4.4 Write property test for tile dimensions (Property 5: Rendered Tile Dimension Invariant)
    - **Property 5: Rendered Tile Dimension Invariant**
    - **Validates: Requirements 2.1, 2.2, 2.3**
    - For any generated Score, all tiles have width ≤ 288, height ≤ 144, pixel values in [0, 15]

- [ ] 5. Implement state machine and event routing
  - [ ] 5.1 Implement `StateMachine` in `src/core/state-machine.ts` — 4-state FSM (IDLE, COUNTING, SCROLLING, PAUSED) with transition table per design; include `onStateChange` callback; DOUBLE_TAP triggers shutdown from any state
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 8.1_
  - [ ]* 5.2 Write property tests for state machine (Properties 7, 8: Toggle and Double-Tap)
    - **Property 7: Auto-Scroll State Machine Toggle**
    - **Property 8: Double-Tap Does Not Alter Scroll State**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.6**
  - [ ] 5.3 Implement `createEventRouter` in `src/core/event-router.ts` — translate raw bridge events into typed AppEvent objects; handle undefined eventType coercion to 0; implement 350ms tap-vs-double-tap discrimination; apply 300ms debounce to scroll gestures
    - _Requirements: 3.5, 3.6, 6.3_

- [ ] 6. Implement scroll engine and count-ahead
  - [ ] 6.1 Implement `ScrollEngine` in `src/core/scroll-engine.ts` — advance viewport by one measure width per measure duration `(beatsPerMeasure × 60 / bpm)` seconds; use timing loop with drift correction; accuracy target ±100ms; support tempo changes mid-scroll within 1 second transition
    - _Requirements: 5.1, 5.4, 5.6_
  - [ ] 6.2 Implement count-ahead logic in `src/core/count-ahead.ts` — wait for configured beats (4/8/12) at tempo-derived interval before signaling COUNT_COMPLETE; display remaining beat count, decrementing once per beat interval
    - _Requirements: 4.1, 4.2, 4.3, 4.5_
  - [ ]* 6.3 Write property tests for count-ahead and scroll rate (Properties 9, 11: Duration Calculation and Scroll Rate)
    - **Property 9: Count-Ahead Duration Calculation**
    - **Property 11: Scroll Rate Matches Tempo and Time Signature**
    - **Validates: Requirements 4.2, 4.3, 5.1, 5.4**
  - [ ] 6.4 Implement manual navigation in the state machine handler — swipe-down advances forward one measure, swipe-up moves back one measure, clamp to [0, N-1]; apply 300ms debounce
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [ ]* 6.5 Write property test for manual navigation (Property 13: Manual Navigation Advances by One Measure)
    - **Property 13: Manual Navigation Advances by One Measure**
    - **Validates: Requirements 6.1, 6.2, 6.4, 6.5**

- [ ] 7. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Implement display controller and layout
  - [ ] 8.1 Implement `DisplayController` in `src/display/controller.ts` — call `createStartUpPageContainer` with 2 containers (image: containerID 1, 288×144 at 0,0; text: containerID 2, 576×144 at 0,144 with `isEventCapture: 1`); implement `showTile`, `updateStatus`, `showError`, `shutdown` methods; handle error return codes from SDK calls
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - [ ]* 8.2 Write property test for viewport measure display (Property 6: Viewport Measure Display Consistency)
    - **Property 6: Viewport Measure Display Consistency**
    - **Validates: Requirements 2.4**
    - For any Score with N measures and position P, text container displays measure (P+1)

- [ ] 9. Implement config and tempo management
  - [ ] 9.1 Implement `ConfigManager` in `src/config/config-manager.ts` — load/save AppConfig from bridge local storage at key `"app_config"`; defaults: `{ countAhead: 4, tempoOverride: null }`; persist count-ahead between sessions
    - _Requirements: 4.1, 4.4_
  - [ ] 9.2 Implement tempo override validation and application — accept values 20-400 BPM, reject out-of-range with error message, apply within 500ms; handle missing/non-numeric tempo metadata with 120 BPM default
    - _Requirements: 5.2, 5.3, 5.5_
  - [ ]* 9.3 Write property tests for config and tempo (Properties 10, 12: Persistence Round-Trip and Tempo Validation)
    - **Property 10: Count-Ahead Persistence Round-Trip**
    - **Property 12: Tempo Override Validation**
    - **Validates: Requirements 4.4, 5.3, 5.5**

- [ ] 10. Implement score library
  - [ ] 10.1 Implement `LibraryManager` in `src/library/library-manager.ts` — CRUD operations: `save` (store Score JSON at `"score_{id}"`, update index at `"library_index"`), `load`, `delete`, `list`; enforce 50-score limit; handle storage failures with error messages
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_
  - [ ]* 10.2 Write property tests for library (Properties 14, 15: Storage Round-Trip and Deletion)
    - **Property 14: Score Storage Round-Trip**
    - **Property 15: Score Deletion Removes from Library**
    - **Validates: Requirements 9.1, 9.4**

- [ ] 11. Implement application lifecycle and wiring
  - [ ] 11.1 Implement application startup in `src/main.ts` — call `createStartUpPageContainer`, subscribe to `textEvent` and `sysEvent`, initialize state machine, load config, render initial viewport; complete within 5 seconds
    - _Requirements: 8.4_
  - [ ] 11.2 Implement shutdown sequence — on DOUBLE_TAP: stop auto-scroll, unsubscribe all event listeners, call `shutDownPageContainer` (in that order); handle SYSTEM_EXIT_EVENT and ABNORMAL_EXIT_EVENT; handle `beforeunload`
    - _Requirements: 8.1, 8.2, 8.3_
  - [ ] 11.3 Implement foreground lifecycle handling — FOREGROUND_EXIT_EVENT pauses auto-scroll if active; FOREGROUND_ENTER_EVENT restores display state and remains paused
    - _Requirements: 8.5, 8.6_
  - [ ] 11.4 Implement companion app UI in `src/companion/companion.ts` — file import interface, score library list (title + date), settings panel (count-ahead selector, tempo override input), error message display
    - _Requirements: 1.3, 1.4, 1.9, 4.1, 5.3, 5.5, 9.2, 9.4_

- [ ] 12. Integration wiring and final assembly
  - [ ] 12.1 Wire all components together — connect parser router → library manager → renderer → display controller → state machine → scroll engine → event router; ensure data flows end-to-end from import through display and scrolling
    - _Requirements: 1.1, 1.2, 2.1, 3.1, 5.1, 9.3_
  - [ ]* 12.2 Write integration tests for full pipeline
    - Test import-to-display pipeline with fixture files
    - Test library CRUD with mock bridge storage
    - Test event routing end-to-end with simulated tap/swipe sequences
    - _Requirements: 1.1, 1.2, 2.1, 3.1, 5.1, 9.1, 9.3_

- [ ] 13. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The application targets the Even G2's 576×288 4-bit greyscale display
- All bridge interactions use the Even SDK APIs (`createStartUpPageContainer`, `updateImageRawData`, `textContainerUpgrade`, etc.)
- Storage uses bridge `setLocalStorage` / `getLocalStorage` — the only persistence API available

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "4.1", "4.2", "5.1", "9.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.4", "4.3", "5.2", "5.3", "9.2"] },
    { "id": 4, "tasks": ["2.5", "2.6", "4.4", "6.1", "6.2", "6.4", "8.1", "9.3", "10.1"] },
    { "id": 5, "tasks": ["6.3", "6.5", "8.2", "10.2"] },
    { "id": 6, "tasks": ["11.1", "11.2", "11.3", "11.4"] },
    { "id": 7, "tasks": ["12.1"] },
    { "id": 8, "tasks": ["12.2"] }
  ]
}
```
