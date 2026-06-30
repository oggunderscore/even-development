"""Linux dev-bridge: real Flipper Zero over USB-CDC RPC, same WebSocket
contract as the Android bridge stub.

Wire format on the serial side after `start_rpc_session`:
  <varint length> <Main protobuf>
repeated. Flipper pushes ScreenFrame messages asynchronously after we send
a GuiStartScreenStreamRequest.

Flipper's ScreenFrame.data is 1024 bytes in SSD1306 "page" layout:
  byte[page*128 + col] holds 8 vertical pixels at column `col`,
  bit (1 << row_in_page) = pixel (col, page*8 + row_in_page).
The webapp expects row-major MSB-first; we transcode here.
"""

import asyncio
import base64
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "pb"))

import serial  # noqa: E402
import websockets  # noqa: E402
from google.protobuf.internal.decoder import _DecodeVarint32  # noqa: E402
from google.protobuf.internal.encoder import _VarintBytes  # noqa: E402

import flipper_pb2  # noqa: E402
import gui_pb2  # noqa: E402

PORT = "/dev/ttyACM0"
WS_HOST = "127.0.0.1"
WS_PORT = 9876
WS_PATH = "/ws"

SCR_W = 128
SCR_H = 64
ROW_BYTES = SCR_W // 8  # 16
EXPECTED_FRAME_BYTES = SCR_W * SCR_H // 8  # 1024


def flipper_to_rowmajor(buf: bytes) -> bytes:
    """SSD1306 page format -> row-major MSB-first, 1bpp."""
    if len(buf) != EXPECTED_FRAME_BYTES:
        raise ValueError(f"expected {EXPECTED_FRAME_BYTES} bytes, got {len(buf)}")
    out = bytearray(EXPECTED_FRAME_BYTES)
    for page in range(SCR_H // 8):
        for col in range(SCR_W):
            v = buf[page * SCR_W + col]
            for bit in range(8):
                if v & (1 << bit):
                    y = page * 8 + bit
                    out[y * ROW_BYTES + (col >> 3)] |= 1 << (7 - (col & 7))
    return bytes(out)


KEY_MAP = {
    "up": gui_pb2.UP,
    "down": gui_pb2.DOWN,
    "left": gui_pb2.LEFT,
    "right": gui_pb2.RIGHT,
    "ok": gui_pb2.OK,
    "back": gui_pb2.BACK,
}
TYPE_MAP = {
    "press": gui_pb2.PRESS,
    "release": gui_pb2.RELEASE,
    "short": gui_pb2.SHORT,
    "long": gui_pb2.LONG,
    "repeat": gui_pb2.REPEAT,
}


class FlipperRpc:
    """Synchronous serial RPC wrapper. All I/O happens in a worker thread."""

    def __init__(self, port: str):
        self.s = serial.Serial(port, baudrate=230400, timeout=0.5)
        self._next_id = 1
        self._buf = bytearray()

    def start_session(self) -> None:
        # Critical: command terminator must be \r ALONE, not \r\n. With \r\n the
        # CLI processes start_rpc_session and then immediately interprets the LF
        # as a new empty command, which can corrupt the first protobuf message
        # we send. See flipperzero_protobuf_py:flipper_base.py for the
        # canonical handshake.
        self.s.timeout = 2.0
        self.s.read_until(b">: ")
        self.s.write(b"start_rpc_session\r")
        self.s.flush()
        self.s.read_until(b"\n")
        # Restore the short polling timeout we use during the stream.
        self.s.timeout = 0.2

    def send_screen_stream_start(self) -> None:
        m = flipper_pb2.Main()
        m.command_id = self._next_id
        self._next_id += 1
        m.has_next = False
        m.gui_start_screen_stream_request.SetInParent()
        self._write_msg(m)

    def send_input_event(self, key: str, action: str) -> None:
        k = KEY_MAP.get(key.lower())
        if k is None:
            print(f"[bridge] bad button key {key}", file=sys.stderr)
            return
        # For an action="short" click, emit the full hardware sequence:
        # PRESS -> SHORT -> RELEASE. Many Flipper apps only react to PRESS
        # (or to the full bracket); a lone SHORT often does nothing.
        if action.lower() == "short":
            seq = [gui_pb2.PRESS, gui_pb2.SHORT, gui_pb2.RELEASE]
        elif action.lower() == "long":
            seq = [gui_pb2.PRESS, gui_pb2.LONG, gui_pb2.RELEASE]
        else:
            t = TYPE_MAP.get(action.lower())
            if t is None:
                print(f"[bridge] bad button action {action}", file=sys.stderr)
                return
            seq = [t]
        for t in seq:
            m = flipper_pb2.Main()
            m.command_id = self._next_id
            self._next_id += 1
            m.has_next = False
            m.gui_send_input_event_request.key = k
            m.gui_send_input_event_request.type = t
            data = m.SerializeToString()
            framed = _VarintBytes(len(data)) + data
            print(f"[bridge] -> input cmd_id={m.command_id} key={key}({k}) type={t}", flush=True)
            self.s.write(framed)
            self.s.flush()

    def _write_msg(self, m: flipper_pb2.Main) -> None:
        data = m.SerializeToString()
        self.s.write(_VarintBytes(len(data)) + data)
        self.s.flush()

    def read_msg(self) -> flipper_pb2.Main | None:
        """Try to decode one Main message; return None if not enough bytes yet."""
        chunk = self.s.read(8192)
        if chunk:
            self._buf.extend(chunk)
        if not self._buf:
            return None
        try:
            size, pos = _DecodeVarint32(bytes(self._buf), 0)
        except (IndexError, Exception):
            return None
        if len(self._buf) < pos + size:
            return None
        msg_bytes = bytes(self._buf[pos : pos + size])
        del self._buf[: pos + size]
        m = flipper_pb2.Main()
        try:
            m.ParseFromString(msg_bytes)
        except Exception as e:
            print(f"[bridge] parse error, dropping {size}B: {e}", flush=True)
            return None
        return m

    def close(self) -> None:
        try:
            self.s.close()
        except Exception:
            pass


async def main() -> None:
    rpc = FlipperRpc(PORT)
    rpc.start_session()
    rpc.send_screen_stream_start()
    print(f"[bridge] RPC session started, screen stream requested", flush=True)

    clients: set[websockets.WebSocketServerProtocol] = set()
    seq = 0
    # Shared so a (re)connecting client can force the next frame to emit even if
    # the Flipper screen is byte-identical to what was last sent. This process
    # outlives the glasses webapp; without the reset, a relaunch onto a static
    # screen would be dedup-suppressed forever and the glasses would sit on
    # "waiting for Flipper screen…".
    reset_dedup = {"v": False}

    async def reader() -> None:
        nonlocal seq
        loop = asyncio.get_running_loop()
        last_heartbeat = 0
        frames_since_hb = 0
        last_emit = 0.0
        last_hash = b""
        # Static screen -> no emission at all (hash dedup); changing screen ->
        # cap at ~10 fps so the downstream SDK pipeline doesn't back up.
        MIN_INTERVAL = 0.25
        import time as _t
        import hashlib
        while True:
            msg = await loop.run_in_executor(None, rpc.read_msg)
            now = _t.monotonic()
            if now - last_heartbeat > 2.0:
                print(f"[bridge] hb: frames={frames_since_hb} clients={len(clients)}", flush=True)
                frames_since_hb = 0
                last_heartbeat = now
            if msg is None:
                await asyncio.sleep(0.01)
                continue
            which = msg.WhichOneof("content")
            if which == "gui_screen_frame":
                frame = msg.gui_screen_frame.data
                if len(frame) != EXPECTED_FRAME_BYTES:
                    print(f"[bridge] unexpected frame size {len(frame)}", flush=True)
                    continue
                h = hashlib.blake2b(frame, digest_size=8).digest()
                if reset_dedup["v"]:
                    # A client just (re)connected - force this frame through even
                    # if it matches, so a fresh/relaunched client always gets the
                    # current screen instead of waiting for the next change.
                    reset_dedup["v"] = False
                    last_hash = b""
                if h == last_hash:
                    continue  # screen unchanged, skip
                if now - last_emit < MIN_INTERVAL:
                    continue  # avoid downstream backpressure
                last_hash = h
                last_emit = now
                frames_since_hb += 1
                rowmajor = flipper_to_rowmajor(frame)
                seq += 1
                payload = json.dumps(
                    {
                        "type": "frame",
                        "w": SCR_W,
                        "h": SCR_H,
                        "bpp": 1,
                        "seq": seq,
                        "data": base64.b64encode(rowmajor).decode(),
                    }
                )
                stale = []
                for c in clients:
                    try:
                        await c.send(payload)
                    except Exception:
                        stale.append(c)
                for c in stale:
                    clients.discard(c)
            else:
                # Surface every other Main message to spot ERROR_BUSY, etc.
                print(f"[bridge] <- main cmd_id={msg.command_id} status={msg.command_status} next={msg.has_next} which={which}", flush=True)

    async def handler(ws) -> None:
        clients.add(ws)
        # Force the next frame to emit so this fresh client gets the current
        # screen even if it's unchanged from the last one sent.
        reset_dedup["v"] = True
        print(f"[bridge] client connected ({len(clients)} total)", flush=True)
        try:
            await ws.send(json.dumps({"type": "status", "state": "connected", "info": "linux-usb"}))
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                if msg.get("type") == "button":
                    key = msg.get("key", "")
                    action = msg.get("action", "short")
                    print(f"[bridge] BUTTON {key} ({action})", flush=True)
                    rpc.send_input_event(key, action)
                elif msg.get("type") == "connect":
                    reset_dedup["v"] = True
                    await ws.send(json.dumps({"type": "status", "state": "connected", "info": "linux-usb"}))
        finally:
            clients.discard(ws)
            print(f"[bridge] client disconnected ({len(clients)} remaining)", flush=True)

    server = await websockets.serve(handler, WS_HOST, WS_PORT)
    print(f"[bridge] listening ws://{WS_HOST}:{WS_PORT}{WS_PATH}", flush=True)

    try:
        await asyncio.gather(reader(), server.wait_closed())
    finally:
        rpc.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
