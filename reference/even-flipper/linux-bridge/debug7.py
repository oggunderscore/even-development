"""Fully clean: reboot RPC implicitly by sending stop_session if active, then fresh start."""
import sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "pb"))
import serial
from google.protobuf.internal.encoder import _VarintBytes
from google.protobuf.internal.decoder import _DecodeVarint32
import flipper_pb2

s = serial.Serial("/dev/ttyACM0", baudrate=230400, timeout=0.3)
# Try to wake CLI cleanly. Send a few CRs.
for _ in range(3):
    s.write(b"\r\n"); s.flush(); time.sleep(0.1)
time.sleep(0.5)
while s.read(8192): pass

# Verify we're in CLI by sending uptime.
s.write(b"uptime\r\n"); s.flush()
time.sleep(0.5)
r = bytearray()
while True:
    c = s.read(8192)
    if not c: break
    r.extend(c)
print(f"[uptime response: {r.decode(errors='replace')!r}]")

# Now switch to RPC.
s.write(b"start_rpc_session\r\n"); s.flush()
time.sleep(2.0)
while s.read(8192): pass
print("\n[switched to RPC mode]")

# Request screen stream.
m = flipper_pb2.Main()
m.command_id = 1
m.gui_start_screen_stream_request.SetInParent()
data = m.SerializeToString()
framed = _VarintBytes(len(data)) + data
print(f"[tx gui_start_screen_stream_request] hex={framed.hex()}")
s.write(framed); s.flush()

# Dump bytes for 6 seconds.
deadline = time.time() + 6
total = bytearray()
while time.time() < deadline:
    c = s.read(8192)
    if c:
        total.extend(c)
print(f"\n[rx total {len(total)} bytes in 6s]")
if total:
    print(f"first 64 hex: {bytes(total[:64]).hex()}")
    print(f"last 64 hex:  {bytes(total[-64:]).hex()}")
    # Try to find pattern. Screen frames in Main have field 22 (gui_screen_frame).
    # Tag for field 22 wire 2 = (22<<3)|2 = 178 = 0xb2; varint: 0xb2 0x01
    hits = [i for i in range(len(total)-2) if total[i] == 0xb2 and total[i+1] == 0x01]
    print(f"\n0xb2 0x01 (field 22 tag) hits: {len(hits)} at first offsets {hits[:6]}")
    # Try parse from offset 0 as length-delim
    buf = bytearray(total)
    msgs = 0
    last_was_frame = False
    while buf:
        try:
            size, pos = _DecodeVarint32(bytes(buf), 0)
        except Exception as e:
            print(f"[varint err at byte {bytes(buf[:8]).hex()}: {e}]"); break
        if len(buf) < pos+size:
            print(f"[partial: need {pos+size}, have {len(buf)}, prefix bytes {bytes(buf[:8]).hex()}]"); break
        payload = bytes(buf[pos:pos+size]); del buf[:pos+size]
        mm = flipper_pb2.Main()
        try:
            mm.ParseFromString(payload)
            which = mm.WhichOneof("content")
            extra = ""
            if which == "gui_screen_frame":
                extra = f" frame_bytes={len(mm.gui_screen_frame.data)}"
            print(f"  msg{msgs}: len={size} cmd={mm.command_id} status={mm.command_status} next={mm.has_next} which={which}{extra}")
            msgs += 1
        except Exception as e:
            print(f"  msg{msgs}: parse err: {e} payload first 32 hex: {payload[:32].hex()}")
            msgs += 1
            if msgs > 10: break
    print(f"\n[total parsed: {msgs} messages, leftover {len(buf)} bytes]")
s.close()
