#!/bin/sh
set -eu

log() {
  echo "[entrypoint] $*"
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

try_release_rtl_kernel_drivers() {
  if ! has_command modprobe; then
    log "modprobe not available; skipping kernel driver release"
    return 0
  fi

  if ! lsmod | grep -Eq 'rtl2832_sdr|rtl2832|dvb_usb_rtl28xxu'; then
    log "no RTL kernel drivers currently loaded"
    return 0
  fi

  log "attempting to release RTL kernel drivers for userspace access"

  for module in rtl2832_sdr rtl2832 dvb_usb_rtl28xxu dvb_usb_v2 dvb_core; do
    if lsmod | awk '{print $1}' | grep -Fx "$module" >/dev/null 2>&1; then
      modprobe -r "$module" 2>/dev/null || true
    fi
  done
}

probe_rtl_device() {
  if ! has_command rtl_test; then
    log "rtl_test is not installed"
    return 0
  fi

  if rtl_test -t >/tmp/rtl_test_startup.log 2>&1; then
    log "rtl_test probe succeeded"
    return 0
  fi

  if grep -Eiq 'usb_claim_interface|Kernel driver is active|No supported devices found' /tmp/rtl_test_startup.log; then
    log "rtl_test probe hit a driver claim issue; retrying after module release"
    try_release_rtl_kernel_drivers
    rtl_test -t >/tmp/rtl_test_startup.log 2>&1 || true
  fi

  if [ -s /tmp/rtl_test_startup.log ]; then
    log "rtl_test startup probe output:"
    cat /tmp/rtl_test_startup.log
  fi
}

probe_rtl_device

exec "$@"
