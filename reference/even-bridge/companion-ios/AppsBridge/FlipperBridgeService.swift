import CryptoKit
import Foundation

/// Coordinates FlipperBleClient + FlipperWsServer.
/// Mirrors the logic in the Android BridgeService.kt:
///   BLE bytes  → protobuf parse → hash dedup + 1 s throttle → WS broadcast
///   WS buttons → 60 ms-spaced BLE writes (PRESS → SHORT → RELEASE)
final class FlipperBridgeService {
    static let shared = FlipperBridgeService()

    private let ble = FlipperBleClient()
    private let ws  = FlipperWsServer()
    private var rpcBuf = FlipperRpc.IncomingBuffer()

    // Frame dedup / throttle — matches Android BridgeService.MIN_INTERVAL_MS = 1000
    private let minInterval: TimeInterval = 1.0
    private var lastFrameHash = Data()
    private var lastEmitTime: Date = .distantPast

    private var frameCount = 0
    private var skipCount  = 0
    private var seqNum     = 0
    private var currentBleState: FlipperBleClient.State = .idle

    // Serial queue for frame processing; button delays use asyncAfter on this queue.
    private let workQueue = DispatchQueue(label: "cc.homeauto.appsbridge.flipper.work", qos: .utility)

    var isRunning: Bool { FlipperState.shared.snapshot().running }

    // MARK: - Lifecycle

    func start() {
        guard !isRunning else { return }

        // Route ALL callbacks through workQueue so every property access is
        // on one serial queue — eliminates data races between bleQueue (state
        // changes, RX bytes) and ws.queue (client messages).
        ws.onClientMessage = { [weak self] msg in
            self?.workQueue.async { self?.handleClientMsg(msg) }
        }
        ble.onStateChange = { [weak self] state, info in
            self?.workQueue.async { self?.handleBleState(state, info) }
        }
        ble.onReceive = { [weak self] data in
            self?.workQueue.async { self?.handleBleData(data) }
        }

        ws.start()
        ble.startScanOrConnect()
        FlipperState.shared.setRunning(true)
        print("[FlipperBridgeService] started")
    }

    func stop() {
        guard isRunning else { return }
        ble.disconnect()
        ws.stop()
        FlipperState.shared.setRunning(false)
        print("[FlipperBridgeService] stopped")
    }

    // MARK: - Button pass-through (called from UI / any thread)

    func sendButton(key: String, action: String) {
        workQueue.async { [weak self] in self?.routeButton(key: key, action: action) }
    }

    // MARK: - BLE → WS  (always called on workQueue)

    private func handleBleState(_ state: FlipperBleClient.State, _ info: String?) {
        currentBleState = state
        let wsState: String
        switch state {
        case .scanning, .connecting, .discovering: wsState = "scanning"
        case .ready:                                wsState = "connected"
        case .idle, .disconnected:                  wsState = "disconnected"
        }
        ws.broadcastStatus(wsState, info: info)
        FlipperState.shared.setBleState(state.description, info: info)

        if state == .ready {
            let frame = FlipperRpc.startScreenStreamFrame()
            ble.send(frame)
        }
    }

    // Already on workQueue (dispatched from the onReceive closure).
    private func handleBleData(_ data: Data) {
        let frames = rpcBuf.feed(data)
        for f in frames { processFrame(f) }
    }

    private func processFrame(_ raw: Data) {
        guard raw.count == FlipperRpc.expectedFrameBytes else { return }

        let hash = sha256Prefix8(raw)
        let now  = Date()
        guard hash != lastFrameHash && now.timeIntervalSince(lastEmitTime) >= minInterval else {
            skipCount += 1
            FlipperState.shared.setCounters(frames: frameCount, skips: skipCount)
            return
        }
        lastFrameHash = hash
        lastEmitTime  = now
        seqNum     += 1
        frameCount += 1

        let rowMajor = FlipperRpc.toRowMajor(raw)
        ws.broadcastFrame(seq: seqNum, rowMajorBytes: rowMajor)
        FlipperState.shared.setCounters(frames: frameCount, skips: skipCount)
    }

    // MARK: - WS → BLE

    private func handleClientMsg(_ msg: FlipperWsServer.ClientMsg) {
        switch msg {
        case .connect:
            switch currentBleState {
            case .ready:
                ws.broadcastStatus("connected")
                // Clear dedup so the next incoming frame is always forwarded to the fresh client.
                lastFrameHash = Data()
            case .scanning, .connecting, .discovering:
                ws.broadcastStatus("scanning")
            default:
                ble.startScanOrConnect()
            }

        case .disconnect:
            ble.disconnect()
            ws.broadcastStatus("disconnected")

        case .button(let key, let action):
            routeButton(key: key, action: action)
        }
    }

    private func routeButton(key: String, action: String) {
        guard let chunks = FlipperRpc.inputChunks(key: key, action: action) else {
            print("[FlipperBridgeService] unknown button \(key)/\(action)")
            return
        }
        // 60 ms between events — empirically reliable; tighter values get coalesced.
        for (i, chunk) in chunks.enumerated() {
            workQueue.asyncAfter(deadline: .now() + Double(i) * 0.060) { [weak self] in
                self?.ble.send(chunk)
            }
        }
    }

    // MARK: - Helpers

    private func sha256Prefix8(_ data: Data) -> Data {
        let digest = SHA256.hash(data: data)
        return Data(digest.prefix(8))
    }
}
