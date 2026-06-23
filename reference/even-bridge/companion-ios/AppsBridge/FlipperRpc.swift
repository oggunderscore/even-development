import Foundation

/// Minimal Flipper protobuf encode/decode for the 3 message types the bridge uses.
/// Field numbers from flipperdevices/flipperzero-protobuf (flipper.proto, gui.proto).
/// No SwiftProtobuf dependency — the full protobuf graph is ~60 messages we don't need.
enum FlipperRpc {

    // MARK: - Constants

    static let expectedFrameBytes = 1024  // 128 * 64 / 8
    static let screenW = 128
    static let screenH = 64

    // gui.proto InputKey
    enum InputKey: UInt64 {
        case up = 0, down = 1, right = 2, left = 3, ok = 4, back = 5
        static func from(_ s: String) -> InputKey? {
            switch s.lowercased() {
            case "up":    return .up
            case "down":  return .down
            case "right": return .right
            case "left":  return .left
            case "ok":    return .ok
            case "back":  return .back
            default:      return nil
            }
        }
    }

    // gui.proto InputType
    enum InputType: UInt64 {
        case press = 0, release = 1, short = 2, long = 3
    }

    // MARK: - Encode

    private static let idLock = NSLock()
    private static var _cmdId: UInt32 = 1
    private static func nextId() -> UInt32 {
        idLock.lock(); defer { idLock.unlock() }
        defer { _cmdId &+= 1 }
        return _cmdId
    }

    /// `Main { command_id, has_next=false, gui_start_screen_stream_request={} }`
    static func startScreenStreamFrame() -> Data {
        var msg = Data()
        appendField(&msg, field: 1, varint: UInt64(nextId()))  // command_id
        appendField(&msg, field: 3, varint: 0)                 // has_next = false
        appendEmbedded(&msg, field: 20, body: Data())          // gui_start_screen_stream_request (empty)
        return framed(msg)
    }

    /// Returns length-prefixed protobuf chunks for a button event.
    /// For "short": [PRESS, SHORT, RELEASE] — matches Android BridgeService behavior.
    /// Returns nil for unknown key or action.
    static func inputChunks(key: String, action: String) -> [Data]? {
        guard let k = InputKey.from(key) else { return nil }
        let types: [InputType]
        switch action.lowercased() {
        case "short":   types = [.press, .short, .release]
        case "long":    types = [.press, .long,  .release]
        case "press":   types = [.press]
        case "release": types = [.release]
        default:        return nil
        }
        return types.map { t in
            var body = Data()
            appendField(&body, field: 1, varint: k.rawValue)  // key
            appendField(&body, field: 2, varint: t.rawValue)  // type
            var msg = Data()
            appendField(&msg, field: 1, varint: UInt64(nextId()))
            appendField(&msg, field: 3, varint: 0)
            appendEmbedded(&msg, field: 23, body: body)        // gui_send_input_event_request
            return framed(msg)
        }
    }

    // MARK: - Streaming decode buffer

    struct IncomingBuffer {
        private var buf = Data()

        /// Append incoming BLE bytes; returns any complete screen-frame payloads (1024 bytes each).
        mutating func feed(_ bytes: Data) -> [Data] {
            buf.append(bytes)
            var frames: [Data] = []
            while true {
                guard let (msgLen, hdrLen) = decodeVarint(buf, at: 0) else { break }
                // Sanity bound: Flipper RPC messages are never larger than 64 KB.
                guard msgLen <= 65_536 else { buf = Data(); break }
                let total = hdrLen + Int(msgLen)
                guard buf.count >= total else { break }
                // Use startIndex-relative ranges so the slice is correct regardless
                // of whether buf.startIndex has been advanced by a previous iteration.
                let s = buf.startIndex
                let msgSlice = Data(buf[s + hdrLen ..< s + total])
                // Re-copy after consuming to reset startIndex to 0.
                // Data.removeFirst advances startIndex on iOS instead of recopying,
                // which would corrupt the next decodeVarint call (the root crash cause).
                buf = total < buf.count ? Data(buf[(s + total)...]) : Data()
                if let frame = extractScreenFrameData(msgSlice) {
                    frames.append(frame)
                }
            }
            return frames
        }
    }

    // MARK: - Frame transcode

    /// SSD1306 page-layout (col-major, bit 0 = top of page) → row-major MSB-first, 1 bpp.
    /// Direct port of the Python bridge.py / Android FlipperRpc.flipperToRowMajor.
    static func toRowMajor(_ buf: Data) -> Data {
        precondition(buf.count == expectedFrameBytes)
        var out = Data(count: expectedFrameBytes)
        let rowBytes = screenW / 8  // 16
        for page in 0 ..< (screenH / 8) {
            for col in 0 ..< screenW {
                let v = buf[page * screenW + col]
                for bit in 0 ..< 8 {
                    guard v & (1 << bit) != 0 else { continue }
                    let y = page * 8 + bit
                    let byteIdx = y * rowBytes + (col >> 3)
                    let bitMask = UInt8(1 << (7 - (col & 7)))
                    out[byteIdx] |= bitMask
                }
            }
        }
        return out
    }

    // MARK: - Protobuf decode helpers (private)

    private static func extractScreenFrameData(_ data: Data) -> Data? {
        var pos = 0
        while pos < data.count {
            guard let (tag, tLen) = decodeVarint(data, at: pos) else { return nil }
            pos += tLen
            let fieldNum = tag >> 3
            let wireType = tag & 7
            switch wireType {
            case 0:  // varint — skip
                guard let (_, vLen) = decodeVarint(data, at: pos) else { return nil }
                pos += vLen
            case 2:  // length-delimited
                guard let (len, lLen) = decodeVarint(data, at: pos) else { return nil }
                pos += lLen
                let end = pos + Int(len)
                guard end <= data.count else { return nil }
                if fieldNum == 22 {  // gui_screen_frame
                    return extractBytesField1(Data(data[pos..<end]))
                }
                pos = end
            default:
                return nil
            }
        }
        return nil
    }

    private static func extractBytesField1(_ data: Data) -> Data? {
        var pos = 0
        while pos < data.count {
            guard let (tag, tLen) = decodeVarint(data, at: pos) else { return nil }
            pos += tLen
            let wireType = tag & 7
            let fieldNum = tag >> 3
            switch wireType {
            case 0:
                guard let (_, vLen) = decodeVarint(data, at: pos) else { return nil }
                pos += vLen
            case 2:
                guard let (len, lLen) = decodeVarint(data, at: pos) else { return nil }
                pos += lLen
                let end = pos + Int(len)
                guard end <= data.count else { return nil }
                if fieldNum == 1 { return Data(data[pos..<end]) }
                pos = end
            default:
                return nil
            }
        }
        return nil
    }

    // MARK: - Varint codec (private)

    static func decodeVarint(_ data: Data, at offset: Int) -> (UInt64, Int)? {
        // Use data.startIndex as the base so this works even when startIndex != 0.
        // (Data.removeFirst advances startIndex on iOS rather than recopying.)
        var value: UInt64 = 0
        var shift = 0
        var consumed = 0
        var idx = data.index(data.startIndex, offsetBy: offset)
        while idx < data.endIndex {
            let byte = UInt64(data[idx])
            idx = data.index(after: idx)
            consumed += 1
            value |= (byte & 0x7F) << shift
            if byte & 0x80 == 0 { return (value, consumed) }
            shift += 7
            if shift >= 64 { return nil }
        }
        return nil
    }

    private static func appendVarint(_ data: inout Data, _ value: UInt64) {
        var v = value
        repeat {
            var byte = UInt8(v & 0x7F); v >>= 7
            if v != 0 { byte |= 0x80 }
            data.append(byte)
        } while v != 0
    }

    private static func appendField(_ data: inout Data, field: UInt64, varint value: UInt64) {
        appendVarint(&data, (field << 3) | 0)
        appendVarint(&data, value)
    }

    private static func appendEmbedded(_ data: inout Data, field: UInt64, body: Data) {
        appendVarint(&data, (field << 3) | 2)
        appendVarint(&data, UInt64(body.count))
        data.append(body)
    }

    /// Flipper serial framing: varint(len) + message bytes.
    private static func framed(_ msg: Data) -> Data {
        var out = Data()
        appendVarint(&out, UInt64(msg.count))
        out.append(msg)
        return out
    }
}
