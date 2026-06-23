import Foundation

/// Thread-safe shared state. All managers write here; HTTP server and UI read from here.
final class BridgeState {
    static let shared = BridgeState()

    private let queue = DispatchQueue(label: "cc.homeauto.appsbridge.state")

    // GPS
    private var _speed:    Double  = 0
    private var _heading:  Double? = nil
    private var _lat:      Double? = nil
    private var _lng:      Double? = nil
    private var _accuracy: Double? = nil

    // Media
    private var _title:  String = ""
    private var _artist: String = ""
    private var _status: String = "unknown"

    // Server
    private var _running: Bool = false

    // MARK: - Writes

    func updateGPS(speed: Double, heading: Double?, lat: Double, lng: Double, accuracy: Double?) {
        queue.async {
            self._speed    = max(0, speed)
            self._heading  = heading
            self._lat      = lat
            self._lng      = lng
            self._accuracy = accuracy
        }
    }

    func updateMedia(title: String, artist: String, status: String) {
        queue.async {
            self._title  = title
            self._artist = artist
            self._status = status
        }
    }

    func setRunning(_ running: Bool) {
        queue.async { self._running = running }
    }

    // MARK: - JSON for HTTP server (called from any thread)

    func gpsJSON() -> String {
        queue.sync {
            var parts: [String] = []
            parts.append("\"speed\":\(String(format: "%.4f", _speed))")
            if let h = _heading { parts.append("\"heading\":\(String(format: "%.1f", h))") }
            else                 { parts.append("\"heading\":null") }
            if let v = _lat     { parts.append("\"lat\":\(String(format: "%.6f", v))") }
            else                 { parts.append("\"lat\":null") }
            if let v = _lng     { parts.append("\"lng\":\(String(format: "%.6f", v))") }
            else                 { parts.append("\"lng\":null") }
            if let v = _accuracy { parts.append("\"accuracy\":\(String(format: "%.1f", v))") }
            else                  { parts.append("\"accuracy\":null") }
            return "{\(parts.joined(separator: ","))}"
        }
    }

    func mediaJSON() -> String {
        queue.sync {
            """
            {"title":"\(esc(_title))","artist":"\(esc(_artist))","status":"\(esc(_status))"}
            """
            .trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    // MARK: - Snapshot for SwiftUI

    struct Snapshot {
        var speed:    Double  = 0
        var heading:  Double? = nil
        var lat:      Double? = nil
        var lng:      Double? = nil
        var accuracy: Double? = nil
        var title:    String  = ""
        var artist:   String  = ""
        var status:   String  = "unknown"
        var running:  Bool    = false
    }

    func snapshot() -> Snapshot {
        queue.sync {
            Snapshot(
                speed:    _speed,
                heading:  _heading,
                lat:      _lat,
                lng:      _lng,
                accuracy: _accuracy,
                title:    _title,
                artist:   _artist,
                status:   _status,
                running:  _running
            )
        }
    }

    // MARK: - Helpers

    private func esc(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
         .replacingOccurrences(of: "\"", with: "\\\"")
         .replacingOccurrences(of: "\n", with: "\\n")
         .replacingOccurrences(of: "\r", with: "\\r")
    }
}
