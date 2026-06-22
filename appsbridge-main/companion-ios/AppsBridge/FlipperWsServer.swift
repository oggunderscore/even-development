import Network
import Foundation

/// WebSocket server on ws://127.0.0.1:9876/ws using Network.framework NWProtocolWebSocket.
/// Same JSON wire protocol as the Android WsServer.kt / Ktor bridge.
final class FlipperWsServer {
    static let port: UInt16 = 9876

    enum ClientMsg {
        case connect
        case disconnect
        case button(key: String, action: String)
    }

    var onClientMessage: ((ClientMsg) -> Void)?

    private var listener: NWListener?
    private var connections: [ObjectIdentifier: NWConnection] = [:]
    private let connLock = NSLock()
    private let queue = DispatchQueue(label: "cc.homeauto.appsbridge.flipper.ws", qos: .utility)

    // MARK: - Lifecycle

    func start() {
        guard listener == nil else { return }

        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        // Do NOT also set requiredLocalEndpoint — specifying the port twice
        // (once here, once in NWListener(using:on:)) causes NWListener creation
        // to fail on some iOS versions. The port below is sufficient.

        let wsOpts = NWProtocolWebSocket.Options()
        wsOpts.autoReplyPing = true
        params.defaultProtocolStack.applicationProtocols.insert(wsOpts, at: 0)

        guard let nwPort = NWEndpoint.Port(rawValue: Self.port),
              let l = try? NWListener(using: params, on: nwPort)
        else {
            print("[FlipperWsServer] Failed to create listener on \(Self.port)")
            return
        }
        listener = l
        l.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
        l.stateUpdateHandler = { state in
            print("[FlipperWsServer] listener state: \(state)")
        }
        l.start(queue: queue)
        print("[FlipperWsServer] Listening on ws://127.0.0.1:\(Self.port)/ws")
    }

    func stop() {
        connLock.lock()
        let conns = Array(connections.values)
        connections.removeAll()
        connLock.unlock()
        for c in conns { c.cancel() }
        listener?.cancel()
        listener = nil
        print("[FlipperWsServer] Stopped")
    }

    // MARK: - Broadcast

    func broadcastStatus(_ state: String, info: String? = nil) {
        var payload = #"{"type":"status","state":"\#(jsonEsc(state))""#
        if let i = info { payload += #","info":"\#(jsonEsc(i))""# }
        payload += "}"
        sendAll(payload)
    }

    func broadcastFrame(seq: Int, rowMajorBytes: Data) {
        let b64 = rowMajorBytes.base64EncodedString()
        let payload = #"{"type":"frame","w":128,"h":64,"bpp":1,"seq":\#(seq),"data":"\#(b64)"}"#
        sendAll(payload)
    }

    // MARK: - Connection handling

    private func accept(_ conn: NWConnection) {
        let id = ObjectIdentifier(conn)
        connLock.lock(); connections[id] = conn; connLock.unlock()

        conn.stateUpdateHandler = { [weak self, weak conn] state in
            guard let conn else { return }
            switch state {
            case .failed, .cancelled:
                self?.drop(conn)
            default:
                break
            }
        }
        conn.start(queue: queue)
        print("[FlipperWsServer] client connected (total=\(connections.count))")

        // Greet the new webapp client immediately so the UI doesn't wait.
        sendTo(conn, #"{"type":"status","state":"disconnected","info":"ios-ble"}"#)
        scheduleReceive(conn)
    }

    private func scheduleReceive(_ conn: NWConnection) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65_536) {
            [weak self, weak conn] data, context, _, error in
            guard let self, let conn else { return }
            if let error {
                print("[FlipperWsServer] receive error: \(error)")
                self.drop(conn)
                return
            }
            if let data, !data.isEmpty,
               let meta = context?.protocolMetadata(
                   definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata,
               meta.opcode == .text,
               let text = String(data: data, encoding: .utf8) {
                self.handleText(text)
            }
            self.scheduleReceive(conn)
        }
    }

    private func handleText(_ text: String) {
        guard let obj = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
              let type_ = obj["type"] as? String
        else { return }

        switch type_ {
        case "connect":
            onClientMessage?(.connect)
        case "disconnect":
            onClientMessage?(.disconnect)
        case "button":
            if let key    = obj["key"]    as? String,
               let action = obj["action"] as? String {
                onClientMessage?(.button(key: key, action: action))
            }
        default:
            break
        }
    }

    // MARK: - Send helpers

    private func sendAll(_ text: String) {
        connLock.lock(); let conns = Array(connections.values); connLock.unlock()
        for c in conns { sendTo(c, text) }
    }

    private func sendTo(_ conn: NWConnection, _ text: String) {
        let data = Data(text.utf8)
        let meta = NWProtocolWebSocket.Metadata(opcode: .text)
        let ctx  = NWConnection.ContentContext(identifier: "ws-text", metadata: [meta])
        conn.send(content: data, contentContext: ctx, isComplete: true,
                  completion: .contentProcessed { [weak self, weak conn] error in
            if let error {
                print("[FlipperWsServer] send error: \(error)")
                if let conn { self?.drop(conn) }
            }
        })
    }

    private func drop(_ conn: NWConnection) {
        let id = ObjectIdentifier(conn)
        connLock.lock(); connections.removeValue(forKey: id); connLock.unlock()
        conn.cancel()
        print("[FlipperWsServer] client dropped (remaining=\(connections.count))")
    }

    // MARK: - Helpers

    private func jsonEsc(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
         .replacingOccurrences(of: "\"", with: "\\\"")
         .replacingOccurrences(of: "\n", with: "\\n")
         .replacingOccurrences(of: "\r", with: "\\r")
    }
}
