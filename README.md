# Packet Lab

**Send a message by carrier pigeon through a tiny simulated internet, and see how real networks move data.**

Live: https://parniyapeykamiyan.github.io/packet-lab/

You write a message to a friend. It's cut into numbered packets, and each one flies on its own pigeon through six post offices (routers) to your friend. Packets take different routes and arrive out of order. One or two get lost and are sent again. The message only reveals itself in order, the way TCP does it.

## What it shows

| On screen | In a real network |
|---|---|
| Message cut into numbered envelopes | Data split into **packets** |
| Label on each envelope: 3/8, from, to, sum | Packet **header**: sequence number, addresses, **checksum** |
| Post offices passing pigeons along | **Routers** forwarding hop by hop (IP) |
| Pigeons taking different paths | Packets routed independently, arriving **out of order** |
| Red × and a new pigeon on a red trail | **Packet loss** and **retransmission** after a timeout |
| Envelopes waiting in the buffer | TCP's **receive buffer**: in-order delivery only |
| Tick on each envelope | **Checksum** verified |

Turn on **How it works** (top right) to label the map in plain English.

## No server

The whole letter lives in the link, after the `#`. Browsers never send that part to a server, so GitHub Pages only ever serves the static page.

The fragment holds the names, the send time, a random seed for the flight, and the message, compressed with `CompressionStream` (deflate) and base64url-encoded.

- The flight is **deterministic**: the same seed always gives the same routes, delays and losses. It's timed from the send time (30 to 90 seconds), so if your friend opens the link while pigeons are still flying, they watch them land live. If they open it later, the letter is already delivered and they can replay the flight.
- **Password lock** (optional): the message is encrypted in the browser with AES-GCM, using a key derived from the password with PBKDF2 (SHA-256, 250,000 rounds). Without the password the letter can't be read.
- Without a password, **anyone with the link can read the message.**
- **Sharing** sends a pigeon-post notice ("A pigeon is carrying a letter to you from Ana. It lands in about 2 minutes…") with the link, and the link previews as an airmail envelope.

## Run it locally

Plain HTML, CSS and JavaScript (ES modules), no build step.

- VS Code: open the folder and click **Go Live** (Live Server), or
- any static server, e.g. `npx serve .`

Opening `index.html` straight from disk won't work, because ES modules need a server. The password lock needs a secure page (https or localhost).

## Files

```
index.html      page structure
css/style.css   airmail styles
js/app.js       send / receive screens, routing
js/codec.js     link encoding, compression, encryption, packets, checksums
js/flight.js    seeded flight plan: routes, delays, loss, retransmission
js/view.js      map, pigeons, envelope slots, buffer
js/sound.js     optional wing flaps and stamp thud (Web Audio)
assets/og.png   link preview image (rendered from assets/og-source.html)
```

## Accessibility & motion

Motion is slow and calm. With `prefers-reduced-motion`, pigeons hop between post offices instead of gliding, and animations are switched off. Sounds are off by default. Turning them on plays a short test sound, and on iPhone it also works with the silent switch on.
