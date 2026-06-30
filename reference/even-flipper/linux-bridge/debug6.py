"""Dump raw bytes after screen stream request to figure out framing."""
import sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "pb"))
import serial
from google.protobuf.internal.encoder import _VarintBytes
import flipper_pb2

s = serial.Serial("/dev/ttyACM0", baudrate=230400, timeout=0.3)
time.sleep(0.3)
while s.read(8192): pass

s.write(b"start_rpc_session\r\n"); s.flush()
time.sleep(2.0)
while s.read(8192): pass

m = flipper_pb2.Main()
m.command_id = 1
m.gui_start_screen_stream_request.SetInParent()
data = m.SerializeToString()
framed = _VarintBytes(len(data)) + data
print(f"[tx] hex={framed.hex()}")
s.write(framed); s.flush()

# Just dump everything that arrives for 4 seconds.
deadline = time.time() + 4
total = bytearray()
while time.time() < deadline:
    c = s.read(8192)
    if c:
        total.extend(c)
print(f"\n[rx total {len(total)} bytes]")
print(f"first 200 hex: {bytes(total[:200]).hex()}")

# Try to find recognizable patterns. ScreenFrame.data is 1024 bytes.
# A Main with gui_screen_frame would be roughly:
#   varint_len, 08 cmd_id, 18 NN (has_next), b2 01 87 08 (field 22 wire 2, length ~1024)
# Try to find 0xb2 0x01 (tag for field 22 wire 2).
hits = [i for i in range(len(total)-2) if total[i] == 0xb2 and total[i+1] == 0x01]
print(f"\n[0xb2 0x01 occurrences in first 4 seconds: {len(hits)} at offsets {hits[:8]}]")
if hits:
    # Look at first occurrence and decode length
    off = hits[0]
    # varint length follows
    print(f"  context around first hit (offset {off}): hex={bytes(total[max(0,off-8):off+10]).hex()}")

s.close()
