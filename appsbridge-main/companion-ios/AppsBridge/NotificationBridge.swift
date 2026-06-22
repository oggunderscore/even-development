import Foundation
import MessageUI
import UIKit

/// Coordinates iOS Shortcuts webhook → G2 notification push, Deepgram audio proxy, and iMessage reply.
final class NotificationBridge: NSObject {
    static let shared = NotificationBridge()

    private let udKey = "deepgram_api_key"
    private var deepgramTask: URLSessionWebSocketTask?
    private var deepgramSession: URLSession?
    private var currentId: String = ""

    // MARK: - Webhook (called from BridgeServer POST /notifications)

    /// Receives a notification dict from the iOS Shortcuts webhook and broadcasts to G2.
    func received(notification json: [String: Any]) {
        let from  = json["from"]  as? String ?? json["title"] as? String ?? "Unknown"
        let body  = json["body"]  as? String ?? json["text"]  as? String ?? ""
        let phone = json["phone"] as? String ?? ""
        let app   = json["app"]   as? String ?? "Messages"
        let id    = UUID().uuidString
        WsServer.shared.broadcastNotification(id: id, app: app, from: from, body: body, phone: phone, replyable: true)
    }

    // MARK: - Deepgram audio proxy

    func apiKey() -> String {
        UserDefaults.standard.string(forKey: udKey) ?? ""
    }

    func startAudioSession(id: String) {
        stopAudioSession(id: id)
        let key = apiKey()
        guard !key.isEmpty else {
            print("[NotifBridge] No Deepgram API key in UserDefaults '\(udKey)'")
            return
        }
        currentId = id

        var components = URLComponents(string: "wss://api.deepgram.com/v1/listen")!
        components.queryItems = [
            URLQueryItem(name: "model",           value: "nova-2"),
            URLQueryItem(name: "language",        value: "en"),
            URLQueryItem(name: "encoding",        value: "linear16"),
            URLQueryItem(name: "sample_rate",     value: "16000"),
            URLQueryItem(name: "channels",        value: "1"),
            URLQueryItem(name: "interim_results", value: "true"),
        ]
        var request = URLRequest(url: components.url!)
        request.addValue("Token \(key)", forHTTPHeaderField: "Authorization")

        let config  = URLSessionConfiguration.default
        deepgramSession = URLSession(configuration: config)
        deepgramTask    = deepgramSession?.webSocketTask(with: request)
        deepgramTask?.resume()
        receiveDeepgram()
        print("[NotifBridge] Deepgram session started id=\(id)")
    }

    func handleAudioChunk(_ data: Data) {
        deepgramTask?.send(.data(data)) { error in
            if let error = error {
                print("[NotifBridge] Deepgram send error: \(error)")
            }
        }
    }

    func stopAudioSession(id: String) {
        deepgramTask?.cancel(with: .goingAway, reason: nil)
        deepgramTask = nil
        deepgramSession = nil
    }

    private func receiveDeepgram() {
        deepgramTask?.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let msg):
                if case .string(let text) = msg {
                    self.parseTranscript(text)
                }
                self.receiveDeepgram()
            case .failure(let error):
                print("[NotifBridge] Deepgram receive error: \(error)")
            }
        }
    }

    private func parseTranscript(_ text: String) {
        guard let data = text.data(using: .utf8),
              let resp = try? JSONDecoder().decode(DeepgramResponse.self, from: data),
              let transcript = resp.channel.alternatives.first?.transcript,
              !transcript.isEmpty else { return }
        WsServer.shared.broadcastTranscript(id: currentId, text: transcript, isFinal: resp.is_final)
    }

    // MARK: - Reply sending

    func sendReply(id: String, phone: String, body: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if MFMessageComposeViewController.canSendText() {
                self.presentComposeSheet(id: id, phone: phone, body: body)
            } else {
                self.fallbackSmsScheme(id: id, phone: phone, body: body)
            }
        }
    }

    private func presentComposeSheet(id: String, phone: String, body: String) {
        let vc = MFMessageComposeViewController()
        vc.recipients = phone.isEmpty ? [] : [phone]
        vc.body = body
        vc.messageComposeDelegate = self

        guard let root = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first?.windows.first(where: { $0.isKeyWindow })?.rootViewController else {
            fallbackSmsScheme(id: id, phone: phone, body: body)
            return
        }
        // Store id so delegate can broadcast result
        objc_setAssociatedObject(vc, &AssocKeys.notifId, id, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        root.present(vc, animated: true)
    }

    private func fallbackSmsScheme(id: String, phone: String, body: String) {
        let encoded = body.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let urlStr  = phone.isEmpty ? "sms:&body=\(encoded)" : "sms:\(phone)&body=\(encoded)"
        if let url = URL(string: urlStr) {
            UIApplication.shared.open(url)
        }
        WsServer.shared.broadcastReplyResult(id: id, success: true)
    }
}

// MARK: - MFMessageComposeViewControllerDelegate

extension NotificationBridge: MFMessageComposeViewControllerDelegate {
    func messageComposeViewController(
        _ controller: MFMessageComposeViewController,
        didFinishWith result: MessageComposeResult
    ) {
        let id      = objc_getAssociatedObject(controller, &AssocKeys.notifId) as? String ?? ""
        let success = result == .sent
        controller.dismiss(animated: true)
        WsServer.shared.broadcastReplyResult(id: id, success: success)
    }
}

// MARK: - Deepgram response models

private struct DeepgramResponse: Decodable {
    let channel: Channel
    let is_final: Bool
    struct Channel: Decodable {
        let alternatives: [Alternative]
    }
    struct Alternative: Decodable {
        let transcript: String
    }
}

private enum AssocKeys {
    static var notifId = "notifId"
}
