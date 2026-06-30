"""Try harder: dump everything Flipper sends after start_rpc_session, with longer wait."""
import time, serial

s = serial.Serial("/dev/ttyACM0", baudrate=230400, timeout=0.3)
s.write(b"\r\n"); s.flush(); time.sleep(0.5)
junk = s.read(8192); print(f"[wake junk len={len(junk)}]")

s.write(b"start_rpc_session\r\n"); s.flush()
deadline = time.time() + 3.0
buf = bytearray()
while time.time() < deadline:
    c = s.read(4096)
    if c:
        buf.extend(c)
        print(f"[chunk len={len(c)} hex={c[:100].hex()} ascii={c[:100].decode(errors='replace')!r}]")
print(f"[total {len(buf)} bytes after start_rpc_session]")
s.close()
