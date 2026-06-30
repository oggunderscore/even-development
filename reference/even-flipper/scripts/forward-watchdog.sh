#!/usr/bin/env bash
# Keeps `adb forward tcp:9876 -> phone:9876` alive so the desktop webapp /
# simulator can always reach the Flipper Bridge running on the phone.
#
# The adb forward is torn down whenever the phone drops off USB, adb restarts,
# or the cable hiccups - and it is NOT auto-restored, which shows up as a black
# screen ("connection refused") in the simulator. This re-adds it whenever it
# goes missing.
#
# Usage: scripts/forward-watchdog.sh [port] [interval_seconds]
set -u

PORT="${1:-9876}"
INTERVAL="${2:-3}"

echo "[watchdog] keeping adb forward tcp:$PORT alive (check every ${INTERVAL}s); Ctrl-C to stop"

while true; do
  # Is a device connected and authorized?
  if ! adb get-state >/dev/null 2>&1; then
    echo "[watchdog] $(date '+%H:%M:%S') no device (unplugged / unauthorized)"
    sleep "$INTERVAL"
    continue
  fi

  # Is the forward present?
  if adb forward --list 2>/dev/null | grep -q "tcp:$PORT tcp:$PORT"; then
    sleep "$INTERVAL"
    continue
  fi

  # Missing - (re)establish it.
  if adb forward "tcp:$PORT" "tcp:$PORT" >/dev/null 2>&1; then
    echo "[watchdog] $(date '+%H:%M:%S') (re)established forward tcp:$PORT"
  else
    echo "[watchdog] $(date '+%H:%M:%S') forward failed, will retry"
  fi
  sleep "$INTERVAL"
done
