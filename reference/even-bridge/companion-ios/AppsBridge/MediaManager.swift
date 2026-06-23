import Foundation

/// Reads now-playing info and sends transport commands via Apple's private MediaRemote framework.
///
/// MediaRemote is the same internal API used by Control Center and the lock screen — it works
/// universally across Spotify, SoundCloud, Apple Music, and any other audio app.
///
/// SIDELOAD ONLY: This private framework must be stripped before App Store submission.
/// App Store path: replace with MPMusicPlayerController (Apple Music) + Spotify iOS SDK.
final class MediaManager {
    static let shared = MediaManager()

    // C function pointer types for the two MediaRemote calls we need
    private typealias MRGetNowPlaying = @convention(c) (DispatchQueue, @escaping ([String: Any]) -> Void) -> Void
    private typealias MRSendCommand   = @convention(c) (UInt32, AnyObject?) -> Bool

    private let getNowPlaying: MRGetNowPlaying?
    private let sendCommandFn: MRSendCommand?

    private var timer: Timer?

    private init() {
        let handle = dlopen(
            "/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote",
            RTLD_NOW
        )
        getNowPlaying = handle
            .flatMap { dlsym($0, "MRMediaRemoteGetNowPlayingInfo") }
            .map { unsafeBitCast($0, to: MRGetNowPlaying.self) }
        sendCommandFn = handle
            .flatMap { dlsym($0, "MRMediaRemoteSendCommand") }
            .map { unsafeBitCast($0, to: MRSendCommand.self) }

        if getNowPlaying == nil {
            print("[MediaManager] MediaRemote unavailable — media status will show unknown")
        }
    }

    // MARK: - Lifecycle (call from main thread)

    func start() {
        poll()
        timer = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in self?.poll() }
        RunLoop.main.add(timer!, forMode: .common)
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        BridgeState.shared.updateMedia(title: "", artist: "", status: "unknown")
    }

    // MARK: - Commands

    enum Command: UInt32 {
        case play  = 0
        case pause = 1
        case next  = 4
        case prev  = 5
    }

    func send(_ cmd: Command) {
        _ = sendCommandFn?(cmd.rawValue, nil)
    }

    // MARK: - Polling

    private func poll() {
        guard let fn = getNowPlaying else { return }
        fn(.main) { info in
            let title  = info["Title"]  as? String ?? ""
            let artist = info["Artist"] as? String ?? ""
            let rate   = info["PlaybackRate"] as? Double ?? 0
            let status: String
            if title.isEmpty && artist.isEmpty {
                status = "unknown"
            } else {
                status = rate > 0 ? "playing" : "paused"
            }
            BridgeState.shared.updateMedia(title: title, artist: artist, status: status)
        }
    }
}
