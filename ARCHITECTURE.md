# Architecture & Setup

## File Structure

```
/Geo-Deffered-Notification
├── index.html        ← HTML structure and all UI elements
├── style.css         ← All styles, design tokens, animations
├── app.js            ← All application logic
├── README.md         ← Project overview
└── ARCHITECTURE.md   ← This file
```

---

## How to Run

No install, no build step, no server required.

Open `index.html` directly in **Chrome**.

> Firefox works for the map and notifications but has weaker Web Speech API support — voice recognition fallback buttons will appear automatically.

---

## Trip Simulation

| Parameter | Value |
|---|---|
| Duration | 100 seconds |
| Notification interval | ~4 seconds |
| Speed | 40–60 km/h (sinusoidal fluctuation) |
| Route | Built from real Bangalore neighbourhood coordinates |
| Dead zones | 8 fixed corridors — same every run |

The route is built by interpolating a Bézier curve through waypoints from the origin and destination neighbourhoods. The car heading updates live on the map.

---

## Notification System

Notifications are generated randomly from 6 apps every ~4 seconds during the trip.

The routing decision in `processNotification()`:

```js
if (notif.isCritical) {
    // deliver immediately — Maps, System, Phone
} else if (inDeadZone) {
    // queue to pending — WhatsApp, Gmail, Google News
} else {
    // deliver immediately
}
```

WhatsApp uses a Smart Stack — multiple messages in a dead zone collapse into one card with a counter, then expand on flush.

Each notification card records `deferredAt` and `deliveredAt` timestamps. Hold duration is computed and shown on the card.

---

## CallMeBot Integration

Uses the [CallMeBot](https://www.callmebot.com) Telegram API — no API key, no backend.

| Event | Trigger |
|---|---|
| Zone exit (signal restored) | Telegram text message — lists all held notifications with hold times |
| Trip arrival | Telegram voice call — reads full trip summary |

Both use GET requests fired via `new Image().src = url`, which bypasses browser CORS restrictions and works from any static host.

**To change the recipient:**
Open **⚙ App Priorities** → Live Alerts section → update the `@username` field.

Default: `@YNVirulkar`

---

## Tech Stack

| | |
|---|---|
| Map | Leaflet.js v1.9.4 (CartoDB dark tiles, CDN) |
| Voice input/output | Web Speech API (browser-native) |
| Notifications | CallMeBot Telegram API |
| Fonts | Orbitron, Rajdhani, Space Mono (Google Fonts) |
| Dependencies | Zero npm packages |

---

## Deployment

Static files only — deploy anywhere:

- **Netlify Drop** — drag the project folder to [netlify.com/drop](https://netlify.com/drop), get a URL in 30 seconds
- **GitHub Pages** — push to a repo, enable Pages on the `main` branch
- **Vercel** — connect the repo, zero config needed

The CallMeBot integration works from all of the above — it's a plain GET request with no server-side requirements.
