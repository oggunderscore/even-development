import Foundation

/// Thread-safe Flipper bridge state. Mirrors the pattern of BridgeState.swift.
final class FlipperState {
    static let shared = FlipperState()

    private let queue = DispatchQueue(label: "cc.homeauto.appsbridge.flipper.state")

    private var _running  = false
    private var _bleState = "idle"
    private var _bleInfo: String? = nil
    private var _frames   = 0
    private var _skips    = 0

    // MARK: - Writes (any thread)

    func setRunning(_ v: Bool) {
        queue.async { self._running = v }
    }

    func setBleState(_ state: String, info: String?) {
        queue.async { self._bleState = state; self._bleInfo = info }
    }

    func setCounters(frames: Int, skips: Int) {
        queue.async { self._frames = frames; self._skips = skips }
    }

    // MARK: - Snapshot for SwiftUI (any thread)

    struct Snapshot {
        var running  = false
        var bleState = "idle"
        var bleInfo: String? = nil
        var frames   = 0
        var skips    = 0
    }

    func snapshot() -> Snapshot {
        queue.sync {
            Snapshot(
                running:  _running,
                bleState: _bleState,
                bleInfo:  _bleInfo,
                frames:   _frames,
                skips:    _skips
            )
        }
    }
}
