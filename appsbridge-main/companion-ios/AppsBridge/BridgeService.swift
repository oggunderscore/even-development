import Foundation

/// Coordinates the server, location, and media managers.
/// Call start/stop from the main thread.
final class BridgeService {
    static let shared = BridgeService()

    private let server   = BridgeServer()
    private let wsServer = WsServer.shared
    private let location = LocationManager.shared
    private let media    = MediaManager.shared
    private let notif    = NotificationBridge.shared

    var isRunning: Bool { BridgeState.shared.snapshot().running }

    func start() {
        server.start()
        wsServer.start()
        location.start()
        media.start()
        BridgeState.shared.setRunning(true)
        FlipperBridgeService.shared.start()
    }

    func stop() {
        server.stop()
        wsServer.stop()
        location.stop()
        media.stop()
        BridgeState.shared.setRunning(false)
        FlipperBridgeService.shared.stop()
    }
}
