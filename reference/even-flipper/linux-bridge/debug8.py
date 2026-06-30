"""Use the proper handshake from flipperzero_protobuf_py: wait for >: prompt, send \r-only command."""
import sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "pb"))
import serial
from google.protobuf.internal.encoder import _VarintBytes
from google.protobuf.internal.decoder import _DecodeVarint32
import flipper_pb2

s = serial.Serial("/dev/ttyACM0", baudrate=230400, timeout=2.0)

# Wait for CLI prompt.
s.read_until(b">: ")
s.write(b"start_rpc_session\r"); s.flush()
s.read_until(b"\n")
print("[entered RPC mode]")

# Now send gui_start_screen_stream_request
m = flipper_pb2.Main()
m.command_id = 1
m.gui_start_screen_stream_request.SetInParent()
data = m.SerializeToString()
framed = _VarintBytes(len(data)) + data
print(f"[tx {framed.hex()}]")
s.write(framed); s.flush()

# Read messages for 4 seconds
import io
def read_varint():
    out = 0
    shift = 0
    for _ in range(10):
        b = s.read(1)
        if not b: return None
        bv = b[0]
        out |= (bv & 0x7f) << shift
        if not (bv & 0x80): return out
        shift += 7
    return None

deadline = time.time() + 5
msgs = 0
while time.time() < deadline:
    s.timeout = max(0.1, deadline - time.time())
    length = read_varint()
    if length is None:
        print("[timeout/no varint]"); break
    payload = s.read(length)
    if len(payload) < length:
        print(f"[short read: got {len(payload)} of {length}]"); break
    mm = flipper_pb2.Main()
    try:
        mm.ParseFromString(payload)
        which = mm.WhichOneof("content")
        extra = ""
        if which == "gui_screen_frame":
            extra = f" frame_bytes={len(mm.gui_screen_frame.data)} first8={mm.gui_screen_frame.data[:8].hex()}"
        print(f"  msg{msgs}: cmd_id={mm.command_id} status={mm.command_status} next={mm.has_next} which={which}{extra}")
        msgs += 1
        if msgs >= 8: break
    except Exception as e:
        print(f"  parse err: {e}; payload hex first 32: {payload[:32].hex()}")

s.close()
