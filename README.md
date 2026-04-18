# GeoDefer — Geo-Deferred Notification System

**HARMAN Automotive · MIT-Mahe Hackathon 2025 · Proposal 2**

---

## The Problem

Mobile notifications during a drive are sent the moment they're triggered — regardless of whether the driver is in a tunnel, under a flyover, or in any other low-signal area. This causes:

- Failed deliveries and silent retries that drain data
- Notifications arriving out of order or not at all
- Non-urgent alerts distracting the driver at the worst moments

Sending during poor coverage wastes bandwidth, fails silently, and interrupts focus when it matters most.

---

## What GeoDefer Does

GeoDefer queues non-urgent notifications when the vehicle enters a low-coverage zone and releases them as a batch the moment signal is restored.

Urgent alerts (navigation, system warnings, incoming calls) are never held — they bypass the queue entirely.

---

## Defer / Deliver Logic

```
Notification arrives
        │
        ▼
 Is it Critical?  ──── YES ──→  Deliver immediately
 (Maps / System / Phone)
        │
       NO
        │
        ▼
  In a Dead Zone? ──── YES ──→  Queue to Pending
  (poor signal)                 (wait for signal)
        │                              │
       NO                     Signal restored
        │                              │
        ▼                              ▼
  Deliver immediately         Flush entire queue
                              → Deliver all at once
```

### Priority Tiers

| Priority | Apps | Behaviour |
|---|---|---|
| Critical (P1) | Maps, System, Phone | Always delivered, never queued |
| Non-Critical (P2) | WhatsApp, Gmail, Google News | Deferred in dead zones, delivered in good signal |

---

## Dead Zones

8 fixed corridors based on real Bangalore locations with known poor coverage:

| Zone | Road |
|---|---|
| Silk Board Junction | Outer Ring Road |
| KR Puram Underpass | Old Madras Road |
| Hebbal Flyover Tunnel | Bellary Road |
| Electronic City Phase-1 | Hosur Road |
| Marathahalli Bridge | HAL Airport Road |
| Bannerghatta Underpass | Bannerghatta Road |
| Yeshwanthpur Underpass | Chord Road |
| Old Airport Road Dip | HAL–Marathahalli stretch |

Zones are fixed every run — not randomly placed — so behaviour is consistent and reproducible.

---

## Real-World Alerts

When signal is restored, a **Telegram text message** is sent listing every notification that was held and for how long.

On arrival at the destination, a **voice call** delivers a full trip summary — total deferred, zones crossed, average hold time.

Both use the [CallMeBot](https://www.callmebot.com) Telegram API with no backend required.