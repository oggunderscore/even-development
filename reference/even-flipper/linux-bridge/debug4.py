"""After start_rpc_session: is Flipper actually in RPC mode? Test by sending \r\n."""
import time, serial
s = serial.Serial("/dev/ttyACM0", baudrate=230400, timeout=0.3)
time.sleep(0.3)
while s.read(8192): pass

s.write(b"start_rpc_session\r\n"); s.flush()
time.sleep(2.0)
out1 = bytearray()
while True:
    c = s.read(8192)
    if not c: break
    out1.extend(c)
print(f"[after 2s post-start_rpc_session: {len(out1)} bytes]")
print(f"  hex: {out1.hex()}")
print(f"  ascii: {out1.decode(errors='replace')!r}")

# Now send \r\n - in CLI mode, would echo and prompt; in RPC mode, would be garbage.
s.write(b"\r\n"); s.flush()
time.sleep(1.0)
out2 = bytearray()
while True:
    c = s.read(8192)
    if not c: break
    out2.extend(c)
print(f"\n[after \\r\\n: {len(out2)} bytes]")
print(f"  hex: {out2.hex()}")
print(f"  ascii: {out2.decode(errors='replace')!r}")

s.close()
