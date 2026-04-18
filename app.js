/* ════════════════════════════════════════════════════════════╕
   HARMAN GeoDefer — Bangalore Autonomous HUD  v4
   ─────────────────────────────────────────────────────────
   v4 changes:
     • Signal-driven deferral (inDeadZone state, not app flag)
     • Deterministic named dead-zone corridors
     • Deferred-at / Delivered-at timestamps on every card
     • Telegram Bot integration on zone flush
     • End-of-trip stats panel
     • Trip reset flow
╘════════════════════════════════════════════════════════════ */

// ── 0. CALLMEBOT CONFIG ───────────────────────────────────────
/*  CallMeBot Telegram API — no API key needed, just username.
    text.php  = Telegram text message
    start.php = Telegram voice call                             */
let CALLMEBOT_USER = localStorage.getItem('geodefer_cb_user') || '@YNVirulkar';

// ── 1. STATE MACHINE ──────────────────────────────────────────
const AssistantState = Object.freeze({
    IDLE:'IDLE', GREETING:'GREETING', ASK_START:'ASK_START',
    ASK_ORIGIN:'ASK_ORIGIN', ASK_DEST:'ASK_DEST',
    CONFIRMING:'CONFIRMING', NAVIGATING:'NAVIGATING', ARRIVED:'ARRIVED',
});
let state          = AssistantState.IDLE;
let isVoiceEnabled = true;
const DRIVER_NAME  = 'Driver';

// ── 2. STATS TRACKER ──────────────────────────────────────────
const stats = {
    totalReceived:      0,
    deliveredImmediate: 0,
    deferred:           0,
    deadZoneCrossings:  0,
    totalHoldMs:        0,
    tripStartTime:      null,
};
function resetStats() {
    stats.totalReceived      = 0;
    stats.deliveredImmediate = 0;
    stats.deferred           = 0;
    stats.deadZoneCrossings  = 0;
    stats.totalHoldMs        = 0;
    stats.tripStartTime      = null;
}

// ── 3. BANGALORE WAYPOINT GEOCODING ──────────────────────────
const BANGALORE_ROUTES = {
    'indiranagar':    { coord:[12.9784,77.6408], waypoints:[[12.9784,77.6408],[12.9762,77.6388],[12.9750,77.6350]] },
    'koramangala':    { coord:[12.9352,77.6245], waypoints:[[12.9352,77.6245],[12.9380,77.6290],[12.9410,77.6260]] },
    'whitefield':     { coord:[12.9698,77.7499], waypoints:[[12.9698,77.7499],[12.9650,77.7300],[12.9610,77.7100],[12.9591,77.7013]] },
    'yelahanka':      { coord:[13.1005,77.5963], waypoints:[[13.1005,77.5963],[13.0800,77.5975],[13.0600,77.5960]] },
    'jayanagar':      { coord:[12.9250,77.5938], waypoints:[[12.9250,77.5938],[12.9270,77.5960],[12.9290,77.5980]] },
    'electronic city':{ coord:[12.8399,77.6770], waypoints:[[12.8399,77.6770],[12.8520,77.6690],[12.8650,77.6620],[12.8780,77.6560]] },
    'hebbal':         { coord:[13.0350,77.5970], waypoints:[[13.0350,77.5970],[13.0250,77.5960],[13.0100,77.5950]] },
    'rajajinagar':    { coord:[12.9907,77.5530], waypoints:[[12.9907,77.5530],[12.9880,77.5580],[12.9850,77.5640]] },
    'mg road':        { coord:[12.9738,77.6119], waypoints:[[12.9738,77.6119],[12.9720,77.6100],[12.9700,77.6080]] },
    'hsr layout':     { coord:[12.9100,77.6450], waypoints:[[12.9100,77.6450],[12.9150,77.6400],[12.9200,77.6350],[12.9240,77.6300]] },
    'marathahalli':   { coord:[12.9591,77.7013], waypoints:[[12.9591,77.7013],[12.9560,77.6900],[12.9530,77.6800]] },
    'btm layout':     { coord:[12.9166,77.6101], waypoints:[[12.9166,77.6101],[12.9200,77.6130],[12.9230,77.6160]] },
    'malleswaram':    { coord:[13.0035,77.5715], waypoints:[[13.0035,77.5715],[13.0000,77.5750],[12.9970,77.5790]] },
    'jp nagar':       { coord:[12.9063,77.5858], waypoints:[[12.9063,77.5858],[12.9080,77.5900],[12.9100,77.5950]] },
    'bannerghatta':   { coord:[12.8636,77.5982], waypoints:[[12.8636,77.5982],[12.8750,77.5960],[12.8870,77.5940]] },
    'richmond road':  { coord:[12.9630,77.6105], waypoints:[[12.9630,77.6105],[12.9650,77.6140],[12.9670,77.6175]] },
    'bommanahalli':   { coord:[12.8920,77.6476], waypoints:[[12.8920,77.6476],[12.9000,77.6440],[12.9070,77.6400]] },
    'kengeri':        { coord:[12.9066,77.4848], waypoints:[[12.9066,77.4848],[12.9100,77.5000],[12.9140,77.5200],[12.9180,77.5400]] },
    'sarjapur':       { coord:[12.8593,77.6882], waypoints:[[12.8593,77.6882],[12.8700,77.6800],[12.8820,77.6700]] },
    'kr puram':       { coord:[13.0000,77.6950], waypoints:[[13.0000,77.6950],[12.9900,77.6800],[12.9800,77.6640],[12.9700,77.6500]] },
};

function getCoord(key) { return BANGALORE_ROUTES[key] ? BANGALORE_ROUTES[key].coord : null; }

const FALLBACK_START = 'indiranagar';
const FALLBACK_DEST  = 'koramangala';
let originKey   = FALLBACK_START;
let destKey     = FALLBACK_DEST;
let originLabel = 'Indiranagar';
let destLabel   = 'Koramangala';

// ── 4. DEAD ZONE CORRIDORS — fixed, named, deterministic ──────
/*  These represent real Bangalore locations known for poor
    cellular coverage. They are fixed every run so behaviour
    is reproducible and explainable to judges.               */
const DEAD_ZONE_CORRIDORS = [
    { name:'Silk Board Junction',       center:[12.9176,77.6227], radius:480 },
    { name:'KR Puram Underpass',        center:[12.9960,77.6860], radius:400 },
    { name:'Hebbal Flyover Tunnel',     center:[13.0355,77.5968], radius:420 },
    { name:'Electronic City Phase-1',   center:[12.8450,77.6700], radius:440 },
    { name:'Marathahalli Bridge',       center:[12.9568,77.7011], radius:380 },
    { name:'Bannerghatta Underpass',    center:[12.8900,77.6000], radius:360 },
    { name:'Yeshwanthpur Underpass',    center:[13.0275,77.5519], radius:370 },
    { name:'Old Airport Road Dip',      center:[12.9620,77.6480], radius:350 },
];

// ── 5. MAP INIT ───────────────────────────────────────────────
const BLORE_CENTER = [12.9716, 77.5946];
const map = L.map('map', {
    zoomControl:true, attributionControl:false,
    scrollWheelZoom:true, dragging:true,
}).setView(BLORE_CENTER, 12);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom:19 }).addTo(map);

// Car marker
const carIcon = L.divIcon({
    className:'',
    html:'<div class="car-marker" id="carMarkerNode"></div>',
    iconSize:[26,26], iconAnchor:[13,13],
});
let carPosition = { lat:BLORE_CENTER[0], lng:BLORE_CENTER[1] };
const carMarker = L.marker([carPosition.lat, carPosition.lng], { icon:carIcon }).addTo(map);

// Draw fixed dead zones on map (once, permanent)
function initDeadZones() {
    DEAD_ZONE_CORRIDORS.forEach(zone => {
        zone.circle = L.circle(zone.center, {
            color:'#ff1a4e', fillColor:'#ff1a4e', fillOpacity:0.10,
            radius:zone.radius, weight:1.5, dashArray:'6,10',
        }).addTo(map).bindTooltip(
            `<span style="font-family:monospace;font-size:11px">📵 ${zone.name}<br><span style="color:#ff6a8a">Low Coverage Zone</span></span>`,
            { permanent:false, direction:'top', className:'dz-tooltip' }
        );
    });
}
initDeadZones();

// Mutable map elements
let routePolyline = null;
let startCircle   = null;
let endCircle     = null;
let potholes      = [];
let inDeadZone    = false;
let currentZoneName = '';

// ── 6. AUTONOMOUS DRIVE ENGINE ────────────────────────────────
const JOURNEY_DURATION_MS = 100000; // 100s
let autodriveActive  = false;
let journeyStartTime = 0;
let routePath        = [];
let currentHeading   = 0;
let speed            = 0;
let notifDecaying    = false;

function lerp(a, b, t) { return a + (b - a) * t; }

function buildRouteFromWaypoints(oKey, dKey) {
    const oRoute = BANGALORE_ROUTES[oKey];
    const dRoute = BANGALORE_ROUTES[dKey];
    const oWP    = oRoute.waypoints || [oRoute.coord];
    const dWP    = (dRoute.waypoints || [dRoute.coord]).slice().reverse();
    const oCoord = oRoute.coord;
    const dCoord = dRoute.coord;

    const allPoints = [
        oCoord,
        ...oWP.slice(1),
        [lerp(oCoord[0],dCoord[0],0.35), lerp(oCoord[1],dCoord[1],0.35)],
        [lerp(oCoord[0],dCoord[0],0.65), lerp(oCoord[1],dCoord[1],0.65)],
        ...dWP.slice(1).reverse(),
        dCoord,
    ];
    const unique = allPoints.filter((p,i) => {
        if (i===0) return true;
        return !(p[0]===allPoints[i-1][0] && p[1]===allPoints[i-1][1]);
    });

    const dense = [];
    const segs  = unique.length - 1;
    const stepsPerSeg = Math.max(1, Math.floor(100 / segs));
    for (let s = 0; s < segs; s++) {
        const a = unique[s], b = unique[s+1];
        const jMag = 0.004;
        const midLat = lerp(a[0],b[0],0.5) + (Math.random()-0.5)*jMag;
        const midLng = lerp(a[1],b[1],0.5) + (Math.random()-0.5)*jMag;
        for (let i = 0; i <= stepsPerSeg; i++) {
            const t=i/stepsPerSeg, invT=1-t;
            const lat = invT*invT*a[0] + 2*invT*t*midLat + t*t*b[0];
            const lng = invT*invT*a[1] + 2*invT*t*midLng + t*t*b[1];
            if (s>0 && i===0) continue;
            dense.push([lat,lng]);
        }
    }
    return dense;
}

function getInterpolatedPosition(t) {
    if (routePath.length < 2) return routePath[0] || [carPosition.lat,carPosition.lng];
    const totalSegs = routePath.length - 1;
    const floatIdx  = t * totalSegs;
    const idx       = Math.min(Math.floor(floatIdx), totalSegs-1);
    const segT      = floatIdx - idx;
    const a = routePath[idx], b = routePath[idx+1];
    return [lerp(a[0],b[0],segT), lerp(a[1],b[1],segT)];
}

function autonomousDriveTick(timestamp) {
    if (!autodriveActive) return;
    const elapsed  = timestamp - journeyStartTime;
    const progress = Math.min(elapsed / JOURNEY_DURATION_MS, 1);
    const [lat,lng] = getInterpolatedPosition(progress);

    if (routePath.length >= 2) {
        const prevProg = Math.max(progress-0.008, 0);
        const [pLat,pLng] = getInterpolatedPosition(prevProg);
        currentHeading = Math.atan2(lng-pLng, lat-pLat) * 180 / Math.PI;
        const node = document.getElementById('carMarkerNode');
        if (node) node.style.transform = `rotate(${currentHeading-90}deg)`;
    }

    carPosition = { lat, lng };
    carMarker.setLatLng([lat,lng]);
    map.panTo([lat,lng], { animate:true, duration:0.15 });

    speed = 50 + Math.round(10*Math.sin(timestamp/1800 + Math.cos(timestamp/900)));
    document.getElementById('speedDisplay').innerText = speed;
    document.getElementById('routeProgressFill').style.width = (progress*100)+'%';

    checkSpatialState();

    if (JOURNEY_DURATION_MS - elapsed < 5000 && !notifDecaying) {
        startNotificationDecay();
    }

    if (progress < 1) {
        requestAnimationFrame(autonomousDriveTick);
    } else {
        triggerArrivalSequence();
    }
}

// ── 7. ARRIVAL SHUTDOWN SEQUENCE ─────────────────────────────
function startNotificationDecay() {
    notifDecaying = true;
    if (simulationInterval) { clearInterval(simulationInterval); simulationInterval = null; }
}

function triggerArrivalSequence() {
    autodriveActive = false;
    speed = 0;
    document.getElementById('speedDisplay').innerText = '0';

    const dCoord = getCoord(destKey);
    if (dCoord) { carPosition={lat:dCoord[0],lng:dCoord[1]}; carMarker.setLatLng(dCoord); }

    const farewell = `You have reached ${destLabel}. GeoDefer systems entering standby. Have a great day, ${DRIVER_NAME}.`;

    setTimeout(() => {
        document.getElementById('arrivalDestName').textContent = destLabel.toUpperCase();
        document.getElementById('arrivalMsg').textContent = farewell;
        renderArrivalStats();
        document.getElementById('arrivalOverlay').classList.add('active');
        state = AssistantState.ARRIVED;

        // Speak ARIA farewell
        speakNavigationAlert(farewell);

        // CallMeBot voice call — trip summary
        setTimeout(() => sendCallMeBotVoice(buildArrivalVoiceMessage()), 3000);

        document.getElementById('journeyInfo').innerHTML = `✓ Arrived · ${destLabel}`;
    }, 600);
}

function formatDuration(ms) {
    if (!ms || ms <= 0) return '—';
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function renderArrivalStats() {
    const el = document.getElementById('arrivalStats');
    if (!el) return;
    const avgHold = stats.deferred > 0
        ? formatDuration(stats.totalHoldMs / stats.deferred)
        : '—';
    const duration = stats.tripStartTime
        ? formatDuration(Date.now() - stats.tripStartTime)
        : '—';
    el.innerHTML = `
        <div class="stats-grid">
            <div class="stat-item"><div class="stat-val">${stats.totalReceived}</div><div class="stat-lbl">Total Notifications</div></div>
            <div class="stat-item"><div class="stat-val green">${stats.deliveredImmediate}</div><div class="stat-lbl">Delivered Immediately</div></div>
            <div class="stat-item"><div class="stat-val red">${stats.deferred}</div><div class="stat-lbl">Deferred & Held</div></div>
            <div class="stat-item"><div class="stat-val cyan">${stats.deadZoneCrossings}</div><div class="stat-lbl">Dead Zones Crossed</div></div>
            <div class="stat-item"><div class="stat-val yellow">${avgHold}</div><div class="stat-lbl">Avg Hold Time</div></div>
            <div class="stat-item"><div class="stat-val">${duration}</div><div class="stat-lbl">Trip Duration</div></div>
        </div>`;
}

// ── 8. ROUTE SETUP ────────────────────────────────────────────
function setupRoute(oKey, dKey) {
    const oCoord = getCoord(oKey);
    const dCoord = getCoord(dKey);
    if (!oCoord || !dCoord) return false;

    originKey   = oKey;
    destKey     = dKey;
    originLabel = toTitleCase(oKey);
    destLabel   = toTitleCase(dKey);

    if (routePolyline) { map.removeLayer(routePolyline); routePolyline=null; }
    if (startCircle)   { map.removeLayer(startCircle);   startCircle=null; }
    if (endCircle)     { map.removeLayer(endCircle);     endCircle=null; }
    potholes.forEach(p => map.removeLayer(p.circle));
    potholes = [];

    routePath = buildRouteFromWaypoints(oKey, dKey);

    routePolyline = L.polyline(routePath, {
        color:'rgba(0,229,255,0.5)', weight:3.5, dashArray:'8 5',
        lineJoin:'round', lineCap:'round',
    }).addTo(map);

    startCircle = L.circleMarker(oCoord, {
        radius:8, color:'#f0b840', fillColor:'#f0b840', fillOpacity:0.95, weight:2,
    }).addTo(map).bindTooltip(`🚦 ${originLabel} (Start)`, { direction:'top' });

    endCircle = L.circleMarker(dCoord, {
        radius:8, color:'#00ffb3', fillColor:'#00ffb3', fillOpacity:0.95, weight:2,
    }).addTo(map).bindTooltip(`🏁 ${destLabel} (Destination)`, { direction:'top' });

    map.fitBounds(L.latLngBounds([oCoord, dCoord]), { padding:[90,90] });
    scatterPotholes(routePath);

    carPosition = { lat:oCoord[0], lng:oCoord[1] };
    carMarker.setLatLng(oCoord);
    return true;
}

function scatterPotholes(path) {
    const len    = path.length;
    const numPit = 8 + Math.floor(Math.random()*4);
    for (let i = 0; i < numPit; i++) {
        const idx  = Math.floor(3 + (i/numPit)*(len-6));
        const p    = path[idx];
        const jLat = p[0] + (Math.random()-0.5)*0.0025;
        const jLng = p[1] + (Math.random()-0.5)*0.0025;
        const circle = L.circle([jLat,jLng], {
            color:'#ffcc00', fillColor:'#ffcc00', fillOpacity:0.5, radius:25, weight:2,
        }).addTo(map);
        potholes.push({ center:[jLat,jLng], radius:25, circle, alerted:false });
    }
}

// ── 9. SPATIAL CHECKS ─────────────────────────────────────────
function checkSpatialState() {
    if (state !== AssistantState.NAVIGATING) return;
    const pos = L.latLng(carPosition.lat, carPosition.lng);
    let currentlyInZone = false;
    let minDepth = Infinity;
    let zoneName = '';

    for (const zone of DEAD_ZONE_CORRIDORS) {
        const dist = map.distance(pos, L.latLng(zone.center[0], zone.center[1]));
        if (dist < zone.radius) {
            currentlyInZone = true;
            const depth = zone.radius - dist;
            if (depth < minDepth) { minDepth=depth; zoneName=zone.name; }
        }
    }

    updateSignalStrength(currentlyInZone, minDepth);

    if (currentlyInZone !== inDeadZone) {
        inDeadZone = currentlyInZone;
        currentZoneName = zoneName;
        handleZoneTransition();
    }

    for (const ph of potholes) {
        const dist = map.distance(pos, L.latLng(ph.center[0], ph.center[1]));
        if (dist < 90 && !ph.alerted) { ph.alerted=true; triggerPotholeAlert(); }
        else if (dist > 160 && ph.alerted) { ph.alerted=false; }
    }
}

function updateSignalStrength(inZone, depth) {
    const bars = document.querySelectorAll('.signal-bar');
    const sigEl = document.getElementById('signalPct');
    if (!inZone) {
        bars.forEach(b => b.className='signal-bar active');
        if (sigEl) sigEl.textContent = '100%';
    } else {
        bars.forEach(b => b.className='signal-bar');
        bars[0].className='signal-bar poor';
        const pct = Math.max(5, Math.round((1-(depth/600))*30));
        if (depth < 300) bars[1].className='signal-bar poor';
        if (sigEl) sigEl.textContent = pct+'%';
    }
}

function handleZoneTransition() {
    const chromePanels = ['topBar','voicePanel'];
    chromePanels.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('dead-zone-dim', inDeadZone);
    });
    const notifPanels = ['leftPanel','rightPanel'];
    notifPanels.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('dead-zone-dim-sidebar', inDeadZone);
    });

    const alertEl = document.getElementById('zoneAlert');
    if (inDeadZone) {
        alertEl.textContent = `⚠ ${currentZoneName} — Deferring Non-Critical`;
        alertEl.classList.add('visible');
        stats.deadZoneCrossings++;
        speakNavigationAlert(`Entering dead zone at ${currentZoneName}. Non-critical notifications will be deferred.`);
    } else {
        alertEl.classList.remove('visible');
        flushPendingQueue();
    }
}

function triggerPotholeAlert() {
    const el = document.getElementById('potholeAlert');
    el.classList.add('visible');
    speakNavigationAlert('Warning. Pothole detected ahead. Please slow down.');
    setTimeout(() => el.classList.remove('visible'), 3500);
}

// ── 10. APP CONFIG ────────────────────────────────────────────
/*  Priority tiers — no alwaysDefer flag.
    isCritical=true  → deliver immediately regardless of signal
    isCritical=false → deliver if good signal, defer if dead zone */
const apps = [
    { name:'WhatsApp',   desc:'Messages & Calls',        isCritical:false },
    { name:'Maps',       desc:'Navigation Alerts',       isCritical:true  },
    { name:'GoogleNews', desc:'News & Trending Stories', isCritical:false },
    { name:'Gmail',      desc:'Email Notifications',     isCritical:false },
    { name:'System',     desc:'Vehicle Warnings',        isCritical:true  },
    { name:'Phone',      desc:'Incoming Calls',          isCritical:true  },
];

const notificationTemplates = {
    WhatsApp: [
        { title:'Message from Priya',        body:'"Are you on your way? 🚗"' },
        { title:'Group: Team Bangalore',     body:'"Stand-up in 10 mins — join link shared"' },
        { title:'Voice note received',       body:'Priya sent a 0:32 voice note' },
        { title:'Image received',            body:'Rahul shared a photo in Design Sprint' },
        { title:'3 unread messages',         body:'From: Rohan, Neha, and 1 other' },
    ],
    Maps: [
        { title:'Turn left on 100ft Road',   body:'In 200m · ETA 12 min' },
        { title:'Traffic on Hosur Road',     body:'+18 min delay. Rerouting via Bannerghatta' },
        { title:'Speed camera ahead',        body:'Reduce speed — camera zone in 500m' },
        { title:'Route recalculated',        body:'Faster path found — saves 7 minutes' },
    ],
    GoogleNews: [
        { title:'Bangalore Metro Phase 3',   body:'CM announces Phase 3 deadline: Dec 2026' },
        { title:'Startup raises ₹200Cr',     body:'Fintech closes Series B in Bengaluru' },
        { title:'Tech Summit this weekend',  body:'NASSCOM summit at NIMHANS Convention' },
    ],
    Gmail: [
        { title:'Meeting: Sprint Review',    body:'Tomorrow 10 AM · Google Meet link inside' },
        { title:'Invoice from Swiggy',       body:'₹847 charged to HDFC card ending 4521' },
        { title:'FYI: Q3 report attached',   body:'Please review before EOD — Shankar' },
    ],
    System: [
        { title:'Tyre pressure low',         body:'Front-left: 28 PSI (recommended 35 PSI)' },
        { title:'Washer fluid low',          body:'Refill required — Level at 15%' },
        { title:'Service due in 500 km',     body:'Book at HARMAN Service Centre, Indiranagar' },
        { title:'Engine temp normal',        body:'Operating at 87°C — within safe range' },
    ],
    Phone: [
        { title:'Incoming call: Rahul',      body:'Rahul Mehta · Mobile · Tap to answer' },
        { title:'Missed call: Unknown',      body:'+91 98765 XXXXX · 2 missed calls' },
        { title:'Voicemail from Priya',      body:'Priya left a 0:48 voicemail — listen now' },
    ],
};

// ── 11. SMART STACK — WhatsApp Aggregation ────────────────────
let whatsappStack = null;

function getOrCreateWhatsAppStack() {
    if (whatsappStack) {
        whatsappStack.count++;
        whatsappStack.bumped = true;
        return null;
    }
    whatsappStack = {
        id:        'wa-stack-'+Date.now(),
        count:     1,
        timestamp: new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),
        deferredAt: new Date(),
        bumped:    false,
    };
    return whatsappStack;
}

// ── 12. NOTIFICATION QUEUES ───────────────────────────────────
let pendingQueue   = [];
let deliveredQueue = [];
let restoreQueue   = [];
let isRestoring    = false;
let simulationInterval;

function generateRandomNotification() {
    if (state !== AssistantState.NAVIGATING) return;
    if (notifDecaying) return;

    const appObj = apps[Math.floor(Math.random()*apps.length)];
    const tpl    = notificationTemplates[appObj.name];
    const t      = tpl[Math.floor(Math.random()*tpl.length)];
    const notif  = {
        id:         Date.now()+Math.random(),
        app:        appObj.name,
        title:      t.title,
        body:       t.body,
        timestamp:  new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),
        isCritical: appObj.isCritical,
        deferredAt: null,
        deliveredAt: null,
    };
    processNotification(notif);
}

// ── 13. SIGNAL-DRIVEN PROCESS NOTIFICATION ───────────────────
/*  Decision Logic:
    1. isCritical (Maps/System/Phone) → deliver immediately, bypass all deferral
    2. Non-critical + in dead zone    → queue to pending (defer)
    3. Non-critical + good signal     → deliver immediately
    WhatsApp in dead zone uses Smart Stack aggregation.         */
function processNotification(notif) {
    stats.totalReceived++;

    if (notif.isCritical) {
        // RULE 1: Critical always delivered
        notif.deliveredAt = new Date();
        deliverNotification(notif, false);
        stats.deliveredImmediate++;

    } else if (inDeadZone) {
        // RULE 2: Non-critical in dead zone → defer
        if (notif.app === 'WhatsApp') {
            processWhatsAppStack();
        } else {
            notif.deferredAt = new Date();
            queueNotification(notif);
        }
        stats.deferred++;

    } else {
        // RULE 3: Non-critical in good signal → deliver immediately
        notif.deliveredAt = new Date();
        deliverNotification(notif, false);
        stats.deliveredImmediate++;
    }
}

function processWhatsAppStack() {
    const result = getOrCreateWhatsAppStack();
    if (result === null) {
        renderQueues(null, true);
    } else {
        const stackNotif = {
            id:          result.id,
            app:         'WhatsApp',
            isStack:     true,
            count:       1,
            title:       'WhatsApp: 1 New Message',
            body:        'Held to protect your focus while in dead zone.',
            timestamp:   result.timestamp,
            deferredAt:  result.deferredAt,
            deliveredAt: null,
            isCritical:  false,
        };
        pendingQueue.push(stackNotif);
        renderQueues();
    }
}

function queueNotification(notif) {
    pendingQueue.push(notif);
    renderQueues();
}

function deliverNotification(notif, isRestored=false) {
    if (!notif.deliveredAt) notif.deliveredAt = new Date();
    if (notif.deferredAt && notif.deliveredAt) {
        stats.totalHoldMs += (notif.deliveredAt - notif.deferredAt);
    }
    deliveredQueue.unshift(notif);
    if (deliveredQueue.length > 20) deliveredQueue.pop();
    renderQueues(isRestored ? notif.id : null);
    if (state===AssistantState.NAVIGATING && isVoiceEnabled && notif.isCritical) {
        speakNavigationAlert(`${notif.app}: ${notif.title}.`);
    }
}

// ── 14. QUEUE FLUSH ───────────────────────────────────────────
function flushPendingQueue() {
    if (!pendingQueue.length) return;
    const toFlush = [...pendingQueue];
    pendingQueue  = [];
    whatsappStack = null;
    renderQueues();

    if (state === AssistantState.NAVIGATING) {
        speakNavigationAlert(
            `Signal restored. Delivering ${toFlush.length} deferred notification${toFlush.length>1?'s':''}.`
        );
        // Fire CallMeBot WhatsApp alert
        sendCallMeBotText(buildFlushMessage(toFlush));
    }
    toFlush.forEach(n => restoreQueue.push(n));
    if (!isRestoring) drainRestoreQueue();
}

function drainRestoreQueue() {
    if (!restoreQueue.length) { isRestoring=false; return; }
    isRestoring = true;
    const notif = restoreQueue.shift();
    notif.deliveredAt = new Date();
    deliveredQueue.unshift(notif);
    if (deliveredQueue.length > 20) deliveredQueue.length = 20;
    renderQueues(notif.id);
    setTimeout(drainRestoreQueue, 800);
}

// ── 15. CALLMEBOT INTEGRATION ─────────────────────────────────
/*  CallMeBot Telegram — GET request via Image() trick.
    Works from any static host, no CORS issues, no backend.    */

function sendCallMeBotText(text) {
    const url = `https://api.callmebot.com/text.php?user=${encodeURIComponent(CALLMEBOT_USER)}&text=${encodeURIComponent(text)}`;
    new Image().src = url;
}

function sendCallMeBotVoice(text) {
    const url = `https://api.callmebot.com/start.php?user=${encodeURIComponent(CALLMEBOT_USER)}&text=${encodeURIComponent(text)}`;
    new Image().src = url;
}

function buildFlushMessage(notifs) {
    const zone  = currentZoneName || 'Dead Zone';
    const lines = notifs.map(n => {
        const held = (n.deferredAt)
            ? ` (held ${formatDuration(Date.now()-n.deferredAt)})`
            : '';
        return `• ${n.app}: ${n.title}${held}`;
    }).join('\n');
    return `🚨 GeoDefer — Signal Restored!\n📍 Zone: ${zone}\n📬 ${notifs.length} notification(s) released:\n${lines}\n🗺️ Route: ${originLabel} → ${destLabel}\n⏱️ ${stats.deferred} deferred total · ${stats.deadZoneCrossings} zones crossed`;
}

function buildArrivalVoiceMessage() {
    return `GeoDefer trip complete. You have arrived at ${destLabel}. During your journey from ${originLabel}, ${stats.deferred} notifications were deferred across ${stats.deadZoneCrossings} dead zones and delivered on signal restore. Have a great day!`;
}

// ── 16. RENDER ────────────────────────────────────────────────
function renderQueues(restoredId=null, bumpWA=false) {
    const waSlot = pendingQueue.find(n => n.isStack && n.app==='WhatsApp');
    if (waSlot && whatsappStack) {
        waSlot.count = whatsappStack.count;
        waSlot.title = `WhatsApp: ${whatsappStack.count} New Message${whatsappStack.count>1?'s':''}`;
    }
    document.getElementById('pendingCount').innerText   = pendingQueue.length;
    document.getElementById('deliveredCount').innerText = deliveredQueue.length;

    // Sync mobile tab badges
    const mb = document.getElementById('mobPendingBadge');
    const db = document.getElementById('mobDeliveredBadge');
    if (mb) mb.textContent  = pendingQueue.length  > 0 ? pendingQueue.length  : '';
    if (db) db.textContent  = deliveredQueue.length > 0 ? deliveredQueue.length : '';
    document.getElementById('pendingList').innerHTML    = pendingQueue.map(n => createCard(n,true,false,bumpWA&&n.isStack)).join('');
    document.getElementById('deliveredList').innerHTML  = deliveredQueue.map(n => createCard(n,false,n.id===restoredId,false)).join('');
}

function timingLine(notif, isPending) {
    if (isPending && notif.deferredAt) {
        return `<div class="notif-timing">⏸ Deferred at ${notif.deferredAt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>`;
    }
    if (!isPending && notif.deliveredAt) {
        let extra = '';
        if (notif.deferredAt) {
            const held = formatDuration(notif.deliveredAt - notif.deferredAt);
            extra = ` · Held ${held}`;
        }
        return `<div class="notif-timing">✅ Delivered ${notif.deliveredAt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}${extra}</div>`;
    }
    return '';
}

function createCard(notif, isPending, isRestored, isBumped) {
    const isStackCard = notif.isStack && notif.app==='WhatsApp';
    const cls         = notif.isCritical ? 'critical' : notif.app;
    const stackCls    = isStackCard ? 'whatsapp-stack' : '';
    const bumpCls     = isBumped   ? 'counter-bump'   : '';
    const animCls     = isRestored ? 'restored'        : '';
    const badge       = isPending && !isStackCard ? '<div class="status-badge">Deferred</div>' : '';
    const rTag        = isRestored ? '<div class="restored-tag">↩ Restored</div>'              : '';
    const stackBadge  = isStackCard ? `<div class="stack-counter">${notif.count}</div>`        : '';
    const timing      = timingLine(notif, isPending);

    return `<div class="notif-card ${cls} ${stackCls} ${bumpCls} ${animCls}">
        ${badge}${stackBadge}
        <div class="notif-header">
            <span class="notif-app">${notif.app==='GoogleNews'?'Google News':notif.app}</span>
            <span>${notif.timestamp}</span>
        </div>
        <div class="notif-title">${notif.title}</div>
        <div class="notif-body">${notif.body}</div>
        ${timing}${rTag}
    </div>`;
}

// ── 17. SPEECH SYNTHESIS ─────────────────────────────────────
function speak(text, onEnd) {
    if (!('speechSynthesis' in window)) { onEnd&&onEnd(); return; }
    window.speechSynthesis.cancel();
    const msg = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const pref = voices.find(v=>v.lang.startsWith('en') && /female|zira|samantha|karen|moira|tessa|victoria/i.test(v.name))
              || voices.find(v=>v.lang.startsWith('en'));
    if (pref) msg.voice=pref;
    msg.rate=0.82; msg.pitch=1.05; msg.volume=0.92;
    msg.onstart = () => {
        document.getElementById('vpAvatar').classList.add('speaking');
        document.getElementById('waveform').classList.add('active');
    };
    msg.onend = () => {
        document.getElementById('vpAvatar').classList.remove('speaking');
        document.getElementById('waveform').classList.remove('active');
        onEnd&&onEnd();
    };
    window.speechSynthesis.speak(msg);
}
if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

function speakNavigationAlert(text) {
    if (!isVoiceEnabled || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const msg = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const pref = voices.find(v=>v.lang.startsWith('en') && /female|zira|samantha|karen|moira|tessa|victoria/i.test(v.name))
              || voices.find(v=>v.lang.startsWith('en'));
    if (pref) msg.voice=pref;
    msg.rate=0.82; msg.pitch=1.05; msg.volume=0.92;
    window.speechSynthesis.speak(msg);
}

// ── 18. SPEECH RECOGNITION ────────────────────────────────────
const SRConstructor = window.SpeechRecognition || window.webkitSpeechRecognition;
let sr=null, srActive=false;
if (SRConstructor) {
    sr = new SRConstructor();
    sr.continuous=false; sr.interimResults=true; sr.lang='en-IN';
    sr.onresult = (e) => {
        let interim='', final='';
        for (let i=e.resultIndex; i<e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) final+=t; else interim+=t;
        }
        document.getElementById('vpUserTranscript').textContent = final||interim;
        if (final) handleUserSpeech(final.trim().toLowerCase());
    };
    sr.onerror = (e) => { if (e.error==='no-speech') return; setMicUI(false); showFallback(); };
    sr.onend   = ()  => { srActive=false; setMicUI(false); };
}
function startListening() { if(!sr){showFallback();return;} if(srActive)return; srActive=true; document.getElementById('vpUserTranscript').textContent=''; setMicUI(true); try{sr.start();}catch(e){} }
function stopListening()  { if(!sr||!srActive)return; srActive=false; try{sr.stop();}catch(e){} setMicUI(false); }
function setMicUI(on) {
    const orb=document.getElementById('micOrb'), st=document.getElementById('micStatus');
    if(on){orb.classList.add('listening');st.classList.add('listening');st.textContent='Listening…';}
    else  {orb.classList.remove('listening');st.classList.remove('listening');st.textContent='Standby';}
}

// ── 19. DIALOGUE STATE MACHINE ────────────────────────────────
function setAssistantText(t) { document.getElementById('vpAssistantText').textContent=t; }
function showVoicePanel()    { document.getElementById('voicePanel').classList.add('visible'); }

function doGreeting() {
    state = AssistantState.GREETING;
    showVoicePanel();
    const msg = 'Hello. ARIA is online. GeoDefer systems active for Bangalore. Shall I initialize your route?';
    setAssistantText(msg);
    speak(msg, () => {
        state = AssistantState.ASK_START;
        setAssistantText('Say "Yes" or "Start" to begin route initialization.');
        startListening(); showFallbackStart();
    });
}
function doAskOrigin() {
    state = AssistantState.ASK_ORIGIN;
    const q = 'Where are we starting from?';
    setAssistantText(q);
    speak(q, () => { startListening(); showFallbackOrigin(); });
}
function doAskDest() {
    state = AssistantState.ASK_DEST;
    const q = 'And where is your destination?';
    setAssistantText(q);
    speak(q, () => { startListening(); showFallbackDest(); });
}
function doConfirmRoute() {
    state = AssistantState.CONFIRMING;
    stopListening(); hideFallback();
    const ok = setupRoute(originKey, destKey);
    if (!ok) {
        const err = 'Sorry, I could not resolve those locations. Please try again.';
        setAssistantText(err);
        speak(err, () => { state=AssistantState.ASK_ORIGIN; doAskOrigin(); });
        return;
    }
    document.getElementById('routePillText').textContent = `${originLabel} → ${destLabel}`;
    document.getElementById('routePill').classList.add('visible');
    const msg = `Setting route from ${originLabel} to ${destLabel}. Autonomous navigation starting shortly. I will manage your notifications throughout.`;
    setAssistantText(msg);
    speak(msg, () => setTimeout(doStartNavigation, 1000));
}
function doStartNavigation() {
    state = AssistantState.NAVIGATING;
    notifDecaying = false;
    stats.tripStartTime = Date.now();

    setAssistantText('');
    ['micOrb','micStatus','vpUserTranscript','waveform','vpAvatar'].forEach(id => {
        const el=document.getElementById(id); if(el) el.style.display='none';
    });
    document.querySelectorAll('.vp-label,.vp-user-row').forEach(el=>el.style.display='none');
    const panel = document.getElementById('voicePanel');
    panel.style.padding='12px 18px'; panel.style.width='auto';

    document.getElementById('journeyInfo').innerHTML =
        `Autonomous · 100-sec flight · ${originLabel} → ${destLabel}`;

    simulationInterval = setInterval(generateRandomNotification, 3800);
    autodriveActive    = true;
    journeyStartTime   = performance.now();
    requestAnimationFrame(autonomousDriveTick);
}

// ── 20. VOICE INPUT HANDLER ───────────────────────────────────
function resolveLocation(text) {
    const lower = text.toLowerCase().trim();
    if (BANGALORE_ROUTES[lower]) return lower;
    for (const key of Object.keys(BANGALORE_ROUTES)) {
        if (lower.includes(key) || key.includes(lower)) return key;
    }
    const words = lower.split(/\s+/);
    for (const key of Object.keys(BANGALORE_ROUTES)) {
        for (const w of words) { if (w.length>3 && key.includes(w)) return key; }
    }
    return null;
}
function handleUserSpeech(text) {
    stopListening();
    document.getElementById('vpUserTranscript').textContent = text;
    if (state===AssistantState.ASK_START) {
        if (/yes|start|yeah|yep|go|ok|sure|engine|initialize|route/i.test(text)) {
            hideFallback(); doAskOrigin();
        } else {
            const r="I didn't catch that. Please say Yes or Start.";
            setAssistantText(r); speak(r,()=>startListening());
        }
    } else if (state===AssistantState.ASK_ORIGIN) {
        const key=resolveLocation(text);
        if (key) { originKey=key; originLabel=toTitleCase(key); hideFallback(); doAskDest(); }
        else {
            const r=`I didn't recognise that. Try Indiranagar, Koramangala, or Whitefield.`;
            setAssistantText(r); speak(r,()=>{startListening();showFallbackOrigin();});
        }
    } else if (state===AssistantState.ASK_DEST) {
        const key=resolveLocation(text);
        if (key) { destKey=key; destLabel=toTitleCase(key); hideFallback(); doConfirmRoute(); }
        else {
            const r=`I didn't recognise that. Try Electronic City, Whitefield, or Hebbal.`;
            setAssistantText(r); speak(r,()=>{startListening();showFallbackDest();});
        }
    }
}

// ── 21. FALLBACK BUTTONS ──────────────────────────────────────
const FALLBACK_ORIGINS = ['indiranagar','koramangala','mg road','rajajinagar','hebbal','malleswaram'];
const FALLBACK_DESTS   = ['whitefield','electronic city','jayanagar','yelahanka','hsr layout','marathahalli'];
function showFallbackStart() {
    if(sr)return;
    const row=document.getElementById('fallbackBtns');
    row.innerHTML=`<button class="vp-btn" onclick="handleUserSpeech('yes')">Yes, Start</button>`;
    row.classList.remove('hidden');
}
function showFallbackOrigin() {
    const row=document.getElementById('fallbackBtns');
    row.innerHTML=FALLBACK_ORIGINS.map(k=>`<button class="vp-btn" onclick="handleUserSpeech('${k}')">${toTitleCase(k)}</button>`).join('');
    row.classList.remove('hidden');
}
function showFallbackDest() {
    const row=document.getElementById('fallbackBtns');
    row.innerHTML=FALLBACK_DESTS.map(k=>`<button class="vp-btn" onclick="handleUserSpeech('${k}')">${toTitleCase(k)}</button>`).join('');
    row.classList.remove('hidden');
}
function showFallback() {
    if(state===AssistantState.ASK_START) showFallbackStart();
    if(state===AssistantState.ASK_ORIGIN)showFallbackOrigin();
    if(state===AssistantState.ASK_DEST)  showFallbackDest();
}
function hideFallback() {
    const row=document.getElementById('fallbackBtns');
    row.classList.add('hidden'); row.innerHTML='';
}

// ── 22. UTILS ─────────────────────────────────────────────────
function toTitleCase(str) { return str.replace(/\b\w/g,c=>c.toUpperCase()); }

// ── 23. CLOCK ─────────────────────────────────────────────────
function updateClock() {
    document.getElementById('clockDisplay').innerText =
        new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
}
updateClock(); setInterval(updateClock,1000);

// ── 24. SETTINGS ──────────────────────────────────────────────
document.getElementById('openSettingsBtn').addEventListener('click',()=>{
    renderSettings();
    document.getElementById('cbUserInput').value = CALLMEBOT_USER;
    document.getElementById('settingsModal').classList.add('active');
});
document.getElementById('closeSettingsBtn').addEventListener('click',()=>{
    document.getElementById('settingsModal').classList.remove('active');
});
document.getElementById('voiceToggle').addEventListener('change',function(){
    isVoiceEnabled=this.checked;
});
document.getElementById('cbSaveBtn').addEventListener('click',()=>{
    CALLMEBOT_USER = document.getElementById('cbUserInput').value.trim() || '@YNVirulkar';
    localStorage.setItem('geodefer_cb_user', CALLMEBOT_USER);
    sendCallMeBotText(`✅ GeoDefer HUD connected!\nHello ${CALLMEBOT_USER} — you will receive text alerts when deferred notifications flush, and a voice call when you arrive at your destination. Ready for your trip!`);
    document.getElementById('cbSaveBtn').textContent = '✓ Saved & Test Sent!';
    setTimeout(()=>{ document.getElementById('cbSaveBtn').textContent='Save & Send Test'; },3000);
});

function renderSettings() {
    const list = document.getElementById('settingsList');
    list.innerHTML = apps.map((app,i)=>`
        <div class="setting-item">
            <div>
                <div class="setting-name">${app.name==='GoogleNews'?'Google News':app.name}</div>
                <div class="setting-desc">${app.desc} · ${app.isCritical?'<span style="color:var(--accent-green)">Critical — Never Deferred</span>':'<span style="color:var(--accent-yellow)">Deferred in Dead Zones</span>'}</div>
            </div>
            <label class="switch">
                <input type="checkbox" onchange="toggleAppCritical(${i})" ${app.isCritical?'checked':''}>
                <span class="slider"></span>
            </label>
        </div>`).join('');
}
window.toggleAppCritical = (i) => { apps[i].isCritical=!apps[i].isCritical; };

// ── 25. LOGIC MODAL ───────────────────────────────────────────
document.getElementById('openLogicBtn').addEventListener('click',()=>{
    document.getElementById('logicModal').classList.add('active');
});
document.getElementById('closeLogicBtn').addEventListener('click',()=>{
    document.getElementById('logicModal').classList.remove('active');
});

// ── 25b. MOBILE TAB SWITCHING ─────────────────────────────────
window.switchMobTab = function(tab) {
    // Reset all tabs
    document.querySelectorAll('.mob-tab').forEach(t => t.classList.remove('active'));
    const key = tab.charAt(0).toUpperCase() + tab.slice(1);
    const btn = document.getElementById('mobTab' + key);
    if (btn) btn.classList.add('active');

    // Toggle drawers
    const left  = document.getElementById('leftPanel');
    const right = document.getElementById('rightPanel');
    left.classList.remove('mobile-open');
    right.classList.remove('mobile-open');

    if (tab === 'pending')   left.classList.add('mobile-open');
    if (tab === 'delivered') right.classList.add('mobile-open');
};

// ── 26. TRIP RESET ────────────────────────────────────────────
document.getElementById('newTripBtn').addEventListener('click',()=>{
    // Reset all state
    autodriveActive = false;
    if (simulationInterval) { clearInterval(simulationInterval); simulationInterval=null; }
    state = AssistantState.IDLE;
    inDeadZone    = false;
    notifDecaying = false;
    pendingQueue  = [];
    deliveredQueue= [];
    restoreQueue  = [];
    isRestoring   = false;
    whatsappStack = null;
    resetStats();

    // Clear map route
    if (routePolyline) { map.removeLayer(routePolyline); routePolyline=null; }
    if (startCircle)   { map.removeLayer(startCircle);   startCircle=null; }
    if (endCircle)     { map.removeLayer(endCircle);     endCircle=null; }
    potholes.forEach(p=>map.removeLayer(p.circle)); potholes=[];

    // Reset UI
    document.getElementById('arrivalOverlay').classList.remove('active');
    document.getElementById('arrivalStats').innerHTML='';
    document.getElementById('speedDisplay').innerText='0';
    document.getElementById('journeyInfo').innerHTML='';
    document.getElementById('routePill').classList.remove('visible');
    document.getElementById('zoneAlert').classList.remove('visible');
    document.getElementById('potholeAlert').classList.remove('visible');
    document.getElementById('routeProgressFill').style.width='0%';
    document.querySelectorAll('.signal-bar').forEach(b=>b.className='signal-bar active');
    document.getElementById('signalPct').textContent='100%';
    renderQueues();

    // Restore voice panel
    ['micOrb','micStatus','vpUserTranscript','waveform','vpAvatar'].forEach(id=>{
        const el=document.getElementById(id); if(el) el.style.removeProperty('display');
    });
    document.querySelectorAll('.vp-label,.vp-user-row').forEach(el=>el.style.removeProperty('display'));
    const panel=document.getElementById('voicePanel');
    panel.style.removeProperty('padding'); panel.style.removeProperty('width');
    panel.classList.remove('visible');

    // Show start screen
    carMarker.setLatLng(BLORE_CENTER);
    map.setView(BLORE_CENTER,12);
    document.getElementById('startScreen').classList.remove('hidden');
});

// ── 27. STARTUP ───────────────────────────────────────────────
document.getElementById('startEngineBtn').addEventListener('click',()=>{
    document.getElementById('startScreen').classList.add('hidden');
    setTimeout(()=>{ renderQueues(); doGreeting(); }, 500);
});

renderQueues();
