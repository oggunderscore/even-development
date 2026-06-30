"""Fresh attempt: clean session, longer waits, simplest request."""
import sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "pb"))
import serial
from google.protobuf.internal.encoder import _VarintBytes
from google.protobuf.internal.decoder import _DecodeVarint32
import flipper_pb2

s = serial.Serial("/dev/ttyACM0", baudrate=230400, timeout=0.3)
# Drain absolutely everything first.
time.sleep(0.5)
while True:
    c = s.read(8192)
    if not c: break

# Send command WITHOUT pre-wake.
s.write(b"start_rpc_session\r\n"); s.flush()
# Wait longer and read everything before sending protobuf.
time.sleep(1.5)
echo = bytearray()
while True:
    c = s.read(8192)
    if not c: break
    echo.extend(c)
print(f"[pre-RPC residual: {len(echo)} bytes]\n  hex={echo.hex()}\n  ascii={echo.decode(errors='replace')!r}")

# Send simplest possible: stop_session (empty).
m = flipper_pb2.Main()
m.command_id = 1
m.stop_session.SetInParent()
data = m.SerializeToString()
print(f"\n[tx stop_session main_len={len(data)} hex={data.hex()}]")
s.write(_VarintBytes(len(data)) + data); s.flush()

deadline = time.time() + 3
buf = bytearray()
while time.time() < deadline:
    c = s.read(4096)
    if c:
        buf.extend(c)
        print(f"[rx raw len={len(c)} hex={c[:60].hex()} ascii={c[:60].decode(errors='replace')!r}]")
        while True:
            try:
                size, pos = _DecodeVarint32(bytes(buf), 0)
            except IndexError: break
            if len(buf) < pos+size: break
            payload = bytes(buf[pos:pos+size]); del buf[:pos+size]
            mm = flipper_pb2.Main()
            try:
                mm.ParseFromString(payload)
                print(f"  decoded: cmd_id={mm.command_id} status={mm.command_status} has_next={mm.has_next} content={mm.WhichOneof('content')}")
            except Exception as e:
                print(f"  parse error: {e}")
s.close()
