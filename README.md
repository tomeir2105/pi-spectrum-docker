# Pi Spectrum Docker

Pi Spectrum Docker is a small Next.js spectrum analyzer for Raspberry Pi + RTL-SDR. It runs entirely in Docker, reaches the dongle directly over USB, and exposes a simple browser UI for device checks and one-shot `rtl_power` scans.

## Features

- Detects the RTL-SDR from inside the container with `lsusb` and `rtl_test`
- Runs one-shot `rtl_power` sweeps from the web UI
- Draws the latest scan as a browser-based spectrum trace
- Scans the FM band for likely stations
- Streams live FM audio in the browser with `rtl_fm` + `ffmpeg`
- Saves station presets in the browser
- Attempts to release conflicting kernel DVB drivers during container startup
- Works on LAN through the Docker-published port

## Requirements

- Raspberry Pi with Docker and Docker Compose
- RTL-SDR plugged into the Pi USB bus
- Permission to run Docker commands

## Quick Start

```bash
docker compose up --build -d
```

Open:

- Local Pi browser: `http://localhost:3002`
- LAN device: `http://<pi-ip>:3002`

On this machine the Pi LAN IP was:

```bash
192.168.1.7
```

So the current LAN URL is:

```bash
http://192.168.1.7:3002
```

## How It Works

The app exposes two API routes:

- `GET /api/sdr/status` runs `lsusb` and `rtl_test -t`
- `POST /api/sdr/scan` runs `rtl_power` and returns a CSV preview

The frontend uses those routes to:

- Confirm the dongle is visible inside Docker
- Run a scan with user-selected frequency settings
- Render the latest sweep as a lightweight spectrum chart
- Find likely FM broadcast stations
- Tune and listen to a selected FM frequency in the browser

## Docker Access Model

This project does not require a host-side SDR API service such as `rtl_tcp`. The container accesses the RTL-SDR directly.

The Compose stack uses:

- USB bus passthrough: `/dev/bus/usb:/dev/bus/usb`
- Kernel module metadata: `/lib/modules:/lib/modules:ro`
- `privileged: true`
- `group_add: plugdev`

This allows the container to claim the dongle itself.

## Startup Driver Handling

Some Raspberry Pi setups auto-attach the kernel DVB driver to the RTL-SDR. To avoid that blocking `rtl_test` or `rtl_power`, [`docker/entrypoint.sh`](/home/user/pi-spectrum-docker/docker/entrypoint.sh) performs a startup probe and tries to release these modules when needed:

- `rtl2832_sdr`
- `rtl2832`
- `dvb_usb_rtl28xxu`
- `dvb_usb_v2`
- `dvb_core`

## Development Notes

- Next.js runs in Docker on internal port `3000`
- Docker publishes it on host port `3002`
- `3000` and `3001` were already occupied on this Pi, so `3002` is used intentionally
- `allowedDevOrigins` includes the Pi LAN host so browser access from other devices works in dev mode

## FM Listening Notes

- The browser player uses the `/api/fm/stream` route
- The FM station finder uses `/api/fm/stations`
- A single RTL-SDR dongle can only be owned by one process at a time
- That means live audio and scanning cannot run at the exact same moment
- The app now reports a friendly busy message instead of the raw `usb_claim_interface` error when that happens

## Useful Commands

```bash
docker compose ps
docker compose logs -f web
docker compose exec web rtl_test -t
docker compose exec web lsusb
```

## Scan Settings

Default UI values:

- Start: `88 MHz`
- End: `108 MHz`
- Bin: `10000 Hz`
- Integration: `2 s`
- Gain: `20.7 dB`

## Current Status

This version has been verified to:

- Start successfully in Docker
- Reach the RTL-SDR from inside the container
- Return live status from `/api/sdr/status`
- Run `rtl_power` and display scan results in the browser
- Stream FM audio to the browser from inside the container
