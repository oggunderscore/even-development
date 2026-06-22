import Foundation
import Network

/// WebSocket server on port 7071 for Even G2 glasses plugin connections.
/// Uses Network.framework's native NWProtocolWebSocket — no external dependencies.
final class WsServer {
    static let shared = WsServer()

    static let port: UInt16 = 7071
    private let queue = DispatchQueue(label: "cc.homeauto.appsbridge.ws", qos: .utility)
    private var listener: NWListener?
    private var connections: [NWConnection] = []
    private let connLock = NSLock()

    func start() {
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        let wsOpts = NWProtocolWebSocket.Options()
        wsOpts.autoReplyPing = true
        params.defaultProtocolStack.applicationProtocols.insert(wsOpts, at: 0)

        guard let port = NWEndpoint.Port(rawValue: Self.port),
              let l = try? NWListener(using: params, on: port) else {
            print("[WsServer] Failed to listen on port \(Self.port)")
            return
        }
        listener = l
        l.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
        l.start(queue: queue)
        print("[WsServer] Listening on port \(Self.port)")
    }

    func stop() {
        listener?.cancel()
        listener = nil
        connLock.lock()
        connections.forEach { $0.cancel() }
        connections.removeAll()
        connLock.unlock()
    }

    // MARK: - Connection handling

    private func accept(_ conn: NWConnection) {
        conn.stateUpdateHandler = { [weak self] state in
            if case .failed = state { self?.remove(conn) }
            if case .cancelled = state { self?.remove(conn) }
        }
        connLock.lock()
        connections.append(conn)
        connLock.unlock()
        conn.start(queue: queue)
        receive(on: conn)
        print("[WsServer] client connected — total=\(connections.count)")
    }

    private func remove(_ conn: NWConnection) {
        connLock.lock()
        connections.removeAll { $0 === conn }
        connLock.unlock()
    }

    private func receive(on conn: NWConnection) {
        conn.receiveMessage { [weak self] data, context, _, error in
            if let error = error {
                if case .posix(let code) = error, code == .ECONNRESET { } else {
                    print("[WsServer] receive error: \(error)")
                }
                self?.remove(conn)
                return
            }
            guard let data = data, !data.isEmpty else {
                self?.receive(on: conn) // keep reading
                return
            }
            let meta = context?.protocolMetadata(definition: NWProtocolWebSocket.definition)
                as? NWProtocolWebSocket.Metadata
            switch meta?.opcode {
            case .text:
                if let str = String(data: data, encoding: .utf8) {
                    self?.handleText(str)
                }
            case .binary:
                NotificationBridge.shared.handleAudioChunk(data)
            case .close:
                self?.remove(conn)
                return
            default:
                break
            }
            self?.receive(on: conn) // continue receiving
        }
    }

    private func handleText(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else { return }

        switch type {
        case "audio_start":
            let id = json["id"] as? String ?? ""
            NotificationBridge.shared.startAudioSession(id: id)
        case "audio_stop":
            let id = json["id"] as? String ?? ""
            NotificationBridge.shared.stopAudioSession(id: id)
        case "send_reply":
            let id    = json["id"]    as? String ?? ""
            let phone = json["phone"] as? String ?? ""
            let body  = json["body"]  as? String ?? ""
            NotificationBridge.shared.sendReply(id: id, phone: phone, body: body)
        default:
            break
        }
    }

    // MARK: - Broadcast helpers

    func broadcastNotification(id: String, app: String, from: String, body: String, phone: String, replyable: Bool) {
        let json = """
        {"type":"notification","data":{"id":"\(esc(id))","app":"\(esc(app))","from":"\(esc(from))","body":"\(esc(body))","phone":"\(esc(phone))","replyable":\(replyable),"timestamp":\(Int(Date().timeIntervalSince1970 * 1000))}}
        """
        broadcast(json)
    }

    func broadcastTranscript(id: String, text: String, isFinal: Bool) {
        let json = """
        {"type":"transcript","id":"\(esc(id))","text":"\(esc(text))","is_final":\(isFinal)}
        """
        broadcast(json)
    }

    func broadcastReplyResult(id: String, success: Bool) {
        broadcast("""{"type":"reply_result","id":"\(esc(id))","success":\(success)}""")
    }

    private func broadcast(_ text: String) {
        guard let data = text.data(using: .utf8) else { return }
        let meta = NWProtocolWebSocket.Metadata(opcode: .text)
        let ctx  = NWConnection.ContentContext(identifier: "ws-text", metadata: [meta])
        connLock.lock()
        let snapshot = connections
        connLock.unlock()
        for conn in snapshot {
            conn.send(content: data, contentContext: ctx, isComplete: true, completion: .idempotent)
        }
    }

    private func esc(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
         .replacingOccurrences(of: "\"", with: "\\\"")
         .replacingOccurrences(of: "\n", with: "\\n")
         .replacingOccurrences(of: "\r", with: "\\r")
    }
}
