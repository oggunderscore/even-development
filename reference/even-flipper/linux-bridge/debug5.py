"""Clean RPC + screen stream request. Try multiple requests."""
import sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "pb"))
import serial
from google.protobuf.internal.encoder import _VarintBytes
from google.protobuf.internal.decoder import _DecodeVarint32
import flipper_pb2

s = serial.Serial("/dev/ttyACM0", baudrate=230400, timeout=0.3)
time.sleep(0.3)
while s.read(8192): pass

s.write(b"start_rpc_session\r\n"); s.flush()
time.sleep(2.0)
echo = bytearray()
while True:
    c = s.read(8192)
    if not c: break
    echo.extend(c)
print(f"[post-start drain: {len(echo)} bytes]")

def send_and_print(label, m):
    data = m.SerializeToString()
    framed = _VarintBytes(len(data)) + data
    print(f"\n[tx {label}] hex={framed.hex()}")
    s.write(framed); s.flush()
    deadline = time.time() + 2
    buf = bytearray()
    while time.time() < deadline:
        c = s.read(4096)
        if c:
            buf.extend(c)
            while True:
                try:
                    size, pos = _DecodeVarint32(bytes(buf), 0)
                except IndexError: break
                if len(buf) < pos+size: break
                payload = bytes(buf[pos:pos+size]); del buf[:pos+size]
                mm = flipper_pb2.Main()
                try:
                    mm.ParseFromString(payload)
                    print(f"  rx: cmd_id={mm.command_id} status={mm.command_status} has_next={mm.has_next} content={mm.WhichOneof('content')}")
                    return mm
                except Exception as e:
                    print(f"  parse err: {e}")
            if buf:
                print(f"  [partial buf {len(buf)} bytes hex={bytes(buf[:30]).hex()}]")
    print("  [no response in 2s]")
    return None

# 1) Empty content - just command_id
m = flipper_pb2.Main(); m.command_id = 1
send_and_print("Main{cmd_id=1, no content}", m)

# 2) explicit empty oneof
m = flipper_pb2.Main(); m.command_id = 2; m.empty.SetInParent()
send_and_print("Main{cmd_id=2, empty}", m)

# 3) system_device_info_request (no body)
m = flipper_pb2.Main(); m.command_id = 3; m.system_device_info_request.SetInParent()
send_and_print("Main{cmd_id=3, system_device_info_request}", m)

# 4) system_ping with empty data
m = flipper_pb2.Main(); m.command_id = 4; m.system_ping_request.SetInParent()
send_and_print("Main{cmd_id=4, ping no data}", m)

# 5) gui_start_screen_stream_request
m = flipper_pb2.Main(); m.command_id = 5; m.gui_start_screen_stream_request.SetInParent()
send_and_print("Main{cmd_id=5, gui_start_screen_stream_request}", m)

# Wait a bit more for any pushed frames
time.sleep(1.0)
extra = bytearray()
while True:
    c = s.read(8192)
    if not c: break
    extra.extend(c)
if extra: print(f"\n[post extra {len(extra)} bytes hex first 80={extra[:80].hex()}]")
else: print("\n[no extra]")
s.close()
