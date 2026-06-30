"""Probe what Flipper sends after start_rpc_session + GuiStartScreenStreamRequest."""
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "pb"))

import serial
from google.protobuf.internal.encoder import _VarintBytes
from google.protobuf.internal.decoder import _DecodeVarint32
import flipper_pb2

s = serial.Serial("/dev/ttyACM0", baudrate=230400, timeout=0.2)

# Wake CLI, drain, request RPC mode.
s.write(b"\r\n")
s.flush()
time.sleep(0.3)
banner = s.read(4096)
print(f"[banner len={len(banner)}]")
print(banner[:300].decode(errors="replace"))
print("...")

s.write(b"start_rpc_session\r\n")
s.flush()
time.sleep(0.3)
# Read whatever residual the CLI emits after issuing the command.
residual = s.read(4096)
print(f"[residual after start_rpc_session len={len(residual)}]")
print(residual[:200].hex())

# Send StartScreenStreamRequest (Main with command_id=1).
m = flipper_pb2.Main()
m.command_id = 1
m.gui_start_screen_stream_request.SetInParent()
data = m.SerializeToString()
framed = _VarintBytes(len(data)) + data
print(f"[tx StartScreenStreamRequest len={len(data)} framed_len={len(framed)}]")
s.write(framed)
s.flush()

# Read raw bytes for 4 seconds; try to decode as varint-framed Main.
deadline = time.time() + 4.0
buf = bytearray()
msgs = 0
while time.time() < deadline:
    chunk = s.read(4096)
    if chunk:
        buf.extend(chunk)
        # Try to drain as many full messages as we have.
        while True:
            try:
                size, pos = _DecodeVarint32(bytes(buf), 0)
            except IndexError:
                break
            if len(buf) < pos + size:
                break
            payload = bytes(buf[pos:pos+size])
            del buf[:pos+size]
            try:
                mm = flipper_pb2.Main()
                mm.ParseFromString(payload)
                which = mm.WhichOneof("content")
                extra = ""
                if which == "gui_screen_frame":
                    extra = f" frame_bytes={len(mm.gui_screen_frame.data)}"
                print(f"[rx] cmd_id={mm.command_id} status={mm.command_status} has_next={mm.has_next} which={which}{extra}")
                msgs += 1
            except Exception as e:
                print(f"[rx-parse-error {e!r}] payload hex={payload[:32].hex()}...")
print(f"[done] total messages={msgs} leftover_bytes={len(buf)}")
if buf:
    print(f"leftover hex first 32: {bytes(buf[:32]).hex()}")
s.close()
