import Network
import Foundation

/// Minimal HTTP server on port 7070 using Network.framework.
/// Serves the same REST API as the Android companion so the HUD app needs no changes.
final class BridgeServer {
    static let port: UInt16 = 7070

    private var listener: NWListener?
    private let queue = DispatchQueue(label: "cc.homeauto.appsbridge.server", qos: .utility)

    func start() {
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true

        guard let nwPort = NWEndpoint.Port(rawValue: Self.port),
              let l = try? NWListener(using: params, on: nwPort) else {
            print("[BridgeServer] Failed to create listener on port \(Self.port)")
            return
        }
        listener = l
        l.newConnectionHandler = { [weak self] conn in self?.handle(conn) }
        l.start(queue: queue)
        print("[BridgeServer] Listening on port \(Self.port)")
    }

    func stop() {
        listener?.cancel()
        listener = nil
        print("[BridgeServer] Stopped")
    }

    // MARK: - Connection handling

    private func handle(_ conn: NWConnection) {
        conn.start(queue: queue)
        conn.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, _, error in
            guard let data = data, !data.isEmpty, let self else { conn.cancel(); return }
            let raw  = String(data: data, encoding: .utf8) ?? ""
            let resp = self.route(raw)
            conn.send(content: resp, completion: .contentProcessed { _ in conn.cancel() })
        }
    }

    private func route(_ raw: String) -> Data {
        let firstLine = raw.components(separatedBy: "\r\n").first ?? ""
        let parts = firstLine.split(separator: " ", maxSplits: 2).map(String.init)
        guard parts.count >= 2 else { return notFound() }
        let method = parts[0]
        let path   = parts[1]

        switch (method, path) {
        case ("GET",  "/gps"):
            return json(BridgeState.shared.gpsJSON())
        case ("GET",  "/media"):
            return json(BridgeState.shared.mediaJSON())
        case ("POST", "/media/play"):
            MediaManager.shared.send(.play);  return noContent()
        case ("POST", "/media/pause"):
            MediaManager.shared.send(.pause); return noContent()
        case ("POST", "/media/next"):
            MediaManager.shared.send(.next);  return noContent()
        case ("POST", "/media/prev"):
            MediaManager.shared.send(.prev);  return noContent()
        case ("OPTIONS", _):
            return options()
        default:
            return notFound()
        }
    }

    // MARK: - Response builders

    private let cors: [(String, String)] = [
        ("Access-Control-Allow-Origin",  "*"),
        ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
        ("Access-Control-Allow-Headers", "Content-Type"),
    ]

    private func json(_ body: String) -> Data {
        respond(status: "200 OK", headers: [("Content-Type", "application/json")] + cors, body: body)
    }

    private func noContent() -> Data {
        respond(status: "204 No Content", headers: cors, body: "")
    }

    private func options() -> Data {
        respond(status: "204 No Content", headers: cors, body: "")
    }

    private func notFound() -> Data {
        respond(status: "404 Not Found", headers: [], body: "Not Found")
    }

    private func respond(status: String, headers: [(String, String)], body: String) -> Data {
        let bodyData = body.data(using: .utf8) ?? Data()
        var head = "HTTP/1.1 \(status)\r\n"
        for (k, v) in headers { head += "\(k): \(v)\r\n" }
        head += "Content-Length: \(bodyData.count)\r\n"
        head += "Connection: close\r\n"
        head += "\r\n"
        var result = head.data(using: .utf8) ?? Data()
        result.append(bodyData)
        return result
    }
}
