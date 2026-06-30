"""Probe whether RPC session is alive via system_ping_request."""
import sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "pb"))

import serial
from google.protobuf.internal.encoder import _VarintBytes
from google.protobuf.internal.decoder import _DecodeVarint32
import flipper_pb2

s = serial.Serial("/dev/ttyACM0", baudrate=230400, timeout=0.2)

# Wake + RPC.
s.write(b"\r\n"); s.flush(); time.sleep(0.3); s.read(8192)
s.write(b"start_rpc_session\r\n"); s.flush(); time.sleep(0.4)
echo = s.read(8192)
print(f"[after start_rpc_session: residual={len(echo)} bytes hex={echo[:50].hex()}]")

# system_ping_request with non-empty payload
m = flipper_pb2.Main()
m.command_id = 42
m.system_ping_request.data = b"hello"
data = m.SerializeToString()
print(f"[tx ping main_len={len(data)} hex={data.hex()}]")
s.write(_VarintBytes(len(data)) + data)
s.flush()

deadline = time.time() + 3
buf = bytearray()
while time.time() < deadline:
    chunk = s.read(4096)
    if chunk:
        print(f"[rx raw len={len(chunk)} hex={chunk[:80].hex()}]")
        buf.extend(chunk)
        while True:
            try:
                size, pos = _DecodeVarint32(bytes(buf), 0)
            except IndexError:
                break
            if len(buf) < pos + size: break
            payload = bytes(buf[pos:pos+size]); del buf[:pos+size]
            mm = flipper_pb2.Main()
            try:
                mm.ParseFromString(payload)
                print(f"[main] cmd_id={mm.command_id} status={mm.command_status} which={mm.WhichOneof('content')}")
                if mm.WhichOneof('content') == 'system_ping_response':
                    print(f"  pong data={bytes(mm.system_ping_response.data)!r}")
            except Exception as e:
                print(f"parse error: {e}; hex={payload[:32].hex()}")
print(f"[done leftover={len(buf)}]")
s.close()
