// A deterministic flight plan: the same seed always gives the same routes,
// delays, losses and resends, so sender and receiver see the same story.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const W = 360, H = 236;

export const NODES = {
  S:  { x: 26,  y: 120 },
  A1: { x: 96,  y: 60,  po: 1 },
  A2: { x: 102, y: 182, po: 2 },
  B1: { x: 180, y: 44,  po: 3 },
  B2: { x: 176, y: 158, po: 4 },
  C1: { x: 262, y: 78,  po: 5 },
  C2: { x: 254, y: 194, po: 6 },
  R:  { x: 334, y: 120 },
};
export const LAYERS = [["S"], ["A1", "A2"], ["B1", "B2"], ["C1", "C2"], ["R"]];
export const LINKS = [];
for (let i = 0; i < LAYERS.length - 1; i++)
  for (const a of LAYERS[i]) for (const b of LAYERS[i + 1]) LINKS.push([a, b]);

export const TAKEOFF = 3; // seconds after sending before the first pigeon leaves

export function buildFlight(seed, n) {
  const r = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];

  // Which packets get lost (always early ones, so later ones must wait).
  const lossCount = n >= 6 && r() < 0.6 ? 2 : 1;
  const pool = Array.from({ length: Math.max(1, Math.ceil(n * 0.6)) }, (_, i) => i);
  const lostSet = new Map();
  while (lostSet.size < Math.min(lossCount, pool.length)) {
    const i = pool.splice(Math.floor(r() * pool.length), 1)[0];
    lostSet.set(i, 1 + Math.floor(r() * 3)); // lost on hop 1..3 (between post offices)
  }
  const total = Math.min(90, Math.max(30, 30 + n * 3.4 + r() * 14));

  // Plan in abstract "units", scale to real seconds at the end.
  const RTO = 7; // retransmission timeout, in units after departure
  const pigeons = [];

  function fly(packet, dep, resend, loseAtHop) {
    const route = LAYERS.map(pick);
    const pts = [{ node: route[0], t: dep }];
    let t = dep;
    for (let h = 1; h < route.length; h++) {
      const dur = 1 + r() * 1.7;
      if (loseAtHop === h) {
        const f = 0.35 + r() * 0.3;
        const a = NODES[route[h - 1]], b = NODES[route[h]];
        pts.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, t: t + dur * f, lost: true });
        return { packet, resend, route: route.slice(0, h + 1), pts, lost: true };
      }
      t += dur;
      pts.push({ node: route[h], t });
      if (h < route.length - 1) {
        const wait = r() < 0.4 ? 0.4 + r() * 1.4 : r() * 0.3; // queueing at a busy post office
        if (wait > 0.08) { t += wait; pts.push({ node: route[h], t }); }
      }
    }
    return { packet, resend, route, pts, lost: false };
  }

  let dep = 0;
  for (let i = 0; i < n; i++) {
    const p = fly(i, dep, false, lostSet.get(i));
    pigeons.push(p);
    if (p.lost) {
      const lostT = p.pts[p.pts.length - 1].t;
      pigeons.push(fly(i, Math.max(dep + RTO, lostT + 1.2), true));
    }
    dep += 0.3 + r() * 0.3;
  }

  const maxU = Math.max(...pigeons.map((p) => p.pts[p.pts.length - 1].t));
  const scale = (total - TAKEOFF - 0.5) / maxU;
  for (const p of pigeons) {
    for (const pt of p.pts) {
      pt.t = TAKEOFF + pt.t * scale;
      if (pt.node) { pt.x = NODES[pt.node].x; pt.y = NODES[pt.node].y; }
    }
    p.start = p.pts[0].t;
    p.end = p.pts[p.pts.length - 1].t;
  }

  const arrive = new Array(n).fill(Infinity);
  for (const p of pigeons) if (!p.lost) arrive[p.packet] = Math.min(arrive[p.packet], p.end);
  const done = Math.max(...arrive);

  return { n, pigeons, arrive, total: done, seed };
}

/** Where a pigeon is at time t, or null if it isn't flying. */
export function pigeonAt(p, t, snap) {
  if (t < p.start || t >= p.end) return null;
  const pts = p.pts;
  let i = 0;
  while (i < pts.length - 2 && pts[i + 1].t <= t) i++;
  const a = pts[i], b = pts[i + 1];
  const ang = a.x === b.x && a.y === b.y ? 0 : Math.atan2(b.y - a.y, b.x - a.x);
  if (snap) return { x: a.x, y: a.y, ang: 0, at: a.node };
  const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2; // ease in-out: calm take-off and landing
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, ang, at: a.x === b.x && a.y === b.y ? a.node : null };
}
