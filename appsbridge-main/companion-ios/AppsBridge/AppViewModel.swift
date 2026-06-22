import SwiftUI
import Combine

@MainActor
final class AppViewModel: ObservableObject {
    @Published var snapshot        = BridgeState.Snapshot()
    @Published var flipperSnapshot = FlipperState.Snapshot()

    private var cancellable: AnyCancellable?

    init() {
        cancellable = Timer.publish(every: 1, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                self?.snapshot        = BridgeState.shared.snapshot()
                self?.flipperSnapshot = FlipperState.shared.snapshot()
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
}
