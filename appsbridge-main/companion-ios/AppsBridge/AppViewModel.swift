import SwiftUI
import Combine

@MainActor
final class AppViewModel: ObservableObject {
    @Published var snapshot           = BridgeState.Snapshot()
    @Published var flipperSnapshot    = FlipperState.Snapshot()
    @Published var deepgramKeySaved   = false
    @Published var deepgramKeyDraft   = ""
    @Published var notifWsClientCount = 0

    private var cancellable: AnyCancellable?

    init() {
        let saved = UserDefaults.standard.string(forKey: "deepgram_api_key") ?? ""
        deepgramKeySaved = !saved.isEmpty

        cancellable = Timer.publish(every: 1, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                self?.snapshot           = BridgeState.shared.snapshot()
                self?.flipperSnapshot    = FlipperState.shared.snapshot()
                self?.notifWsClientCount = WsServer.shared.clientCount
                let k = UserDefaults.standard.string(forKey: "deepgram_api_key") ?? ""
                self?.deepgramKeySaved = !k.isEmpty
            }
    }

    func toggle() {
        if BridgeService.shared.isRunning {
            BridgeService.shared.stop()
        } else {
            BridgeService.shared.start()
        }
        snapshot        = BridgeState.shared.snapshot()
        flipperSnapshot = FlipperState.shared.snapshot()
    }

    func toggleFlipper() {
        if FlipperBridgeService.shared.isRunning {
            FlipperBridgeService.shared.stop()
        } else {
            FlipperBridgeService.shared.start()
        }
        flipperSnapshot = FlipperState.shared.snapshot()
    }

    func sendFlipperButton(_ key: String, _ action: String = "short") {
        FlipperBridgeService.shared.sendButton(key: key, action: action)
    }

    func saveDeepgramKey() {
        let trimmed = deepgramKeyDraft.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        UserDefaults.standard.set(trimmed, forKey: "deepgram_api_key")
        deepgramKeySaved = true
        deepgramKeyDraft = ""
    }

    func sendTestNotification() {
        NotificationBridge.shared.received(notification: [
            "from": "APPS Bridge",
            "body": "Test message — voice reply is working!",
            "app": "Messages",
            "phone": "",
        ])
    }
}
