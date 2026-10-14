// Draws the map, the pigeons, the envelope slots and the buffer,
// all as a pure function of the flight plan and the current time.

import { NODES, LINKS, W, H, pigeonAt } from "./flight.js";
import * as sound from "./sound.js";

const NS = "http://www.w3.org/2000/svg";
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
const html = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const mmss = (s) => {
  s = Math.max(0, Math.round(s));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
};

// pigeon silhouette, facing right, roughly 24 x 14
const BODY = "M1 8.4 L-1.6 6.6 L-1.2 10.2 Z M1 8.4 C4.5 6.6 9.5 6 14.4 6.9 C16.2 5.2 19.2 5.1 20.4 6.8 L23.4 7.4 L20.6 8.4 C20 10.6 17 12.3 12 12.3 C7.6 12.3 4.2 11 1 8.4 Z";
const WING = "M7.5 8 C9.6 3.4 12.8 1 16.2 1.2 C14.6 3.6 13.6 6.2 12.6 8.6 Z";

export class FlightView {
  /**
   * opts: { n, from, to, sums, flight, sealed, onState(state), label }
   */
  constructor(host, opts) {
    this.o = opts;
    this.host = host;
    this.raf = 0;
    this.prevT = null;
    this.lastKey = "";
    this.build();
  }

  build() {
    const { n, from, to, flight } = this.o;
    this.host.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "flight";
    wrap.innerHTML = `
      <div class="flight-head"><span class="fh-l"></span><span class="fh-r"></span></div>`;
    this.headL = wrap.querySelector(".fh-l");
    this.headR = wrap.querySelector(".fh-r");

    const svg = el("svg", { class: "map", viewBox: `-6 -8 ${W + 12} ${H + 22}`, role: "img", "aria-label": `Map: ${n} packets flying from ${from} to ${to} through six post offices` });
    this.svg = svg;
    const gLinks = el("g", {}, svg);
    for (const [a, b] of LINKS) el("line", { class: "link", x1: NODES[a].x, y1: NODES[a].y, x2: NODES[b].x, y2: NODES[b].y }, gLinks);

    // resend routes, drawn as a red dashed trail
    this.reRoutes = new Map();
    for (const p of flight.pigeons) if (p.resend) {
      const d = p.route.map((k, i) => (i ? "L" : "M") + NODES[k].x + " " + NODES[k].y).join(" ");
      this.reRoutes.set(p, el("path", { class: "route-re", d }, svg));
    }

    // post offices
    this.po = {};
    for (const k in NODES) {
      const nd = NODES[k];
      if (!nd.po) continue;
      const g = el("g", { class: "po" }, svg);
      el("circle", { class: "po-ring", cx: nd.x, cy: nd.y, r: 7.5 }, g);
      el("circle", { class: "po-ring", cx: nd.x, cy: nd.y, r: 4.6, "stroke-dasharray": "1.2 1.4" }, g);
      el("circle", { class: "po-dot", cx: nd.x, cy: nd.y, r: 1.3 }, g);
      const tx = el("text", { x: nd.x, y: nd.y + (nd.y > 120 ? 19 : -13), "text-anchor": "middle" }, g);
      tx.textContent = "PO " + nd.po;
      this.po[k] = g;
    }
    // sender and receiver
    for (const [k, name, sub] of [["S", from, "sender"], ["R", to, "receiver"]]) {
      const nd = NODES[k];
      el("rect", { class: "end-box", x: nd.x - 4.5, y: nd.y - 4.5, width: 9, height: 9 }, svg);
      const t1 = el("text", { class: "name", x: nd.x, y: nd.y + 21, "text-anchor": k === "S" ? "start" : "end", dx: k === "S" ? -6 : 6 }, svg);
      t1.textContent = trim(name, 14);
      const t2 = el("text", { x: nd.x, y: nd.y + 31, "text-anchor": k === "S" ? "start" : "end", dx: k === "S" ? -6 : 6 }, svg);
      t2.textContent = sub;
    }
    this.resendLabel = el("text", { class: "resend", x: NODES.S.x - 6, y: NODES.S.y - 14 }, svg);
    this.queueLabel = el("text", { x: NODES.S.x - 6, y: NODES.S.y + 41 }, svg);

    // explain labels
    const ex = el("g", { class: "exg", "aria-hidden": "true" }, svg);
    const exLabel = (x, y, lines, anchor = "start", line) => {
      if (line) el("line", { class: "ex-line", x1: line[0], y1: line[1], x2: line[2], y2: line[3] }, ex);
      lines.forEach((str, i) => {
        const t = el("text", { class: "ex", x, y: y + i * 7.5, "text-anchor": anchor }, ex);
        t.textContent = str;
      });
    };
    exLabel(-2, 75, ["your device:", "cuts & numbers"]);
    exLabel(-2, 214, ["routers = post offices:", "read the address,", "pass it on"], "start", [70, 209, 95, 188]);
    exLabel(362, 12, ["each packet picks", "its own path"], "end");
    exLabel(340, 166, ["friend’s device:", "checks, re-orders"], "end");
    this.exGroup = ex;

    // lost marks
    this.lostMarks = new Map();
    for (const p of flight.pigeons) if (p.lost) {
      const end = p.pts[p.pts.length - 1];
      const g = el("g", { class: "lost", opacity: 0 }, svg);
      el("line", { x1: end.x - 3.2, y1: end.y - 3.2, x2: end.x + 3.2, y2: end.y + 3.2 }, g);
      el("line", { x1: end.x - 3.2, y1: end.y + 3.2, x2: end.x + 3.2, y2: end.y - 3.2 }, g);
      const t = el("text", { x: end.x + 6, y: end.y + 2.4 }, g);
      t.textContent = p.packet + 1 + " lost";
      this.lostMarks.set(p, g);
    }

    // pigeons
    const gp = el("g", {}, svg);
    this.pgEls = new Map();
    flight.pigeons.forEach((p) => {
      const off = ((p.packet % 3) - 1) * 3.2;
      const g = el("g", { class: "pg" + (p.resend ? " re" : ""), opacity: 0 }, gp);
      const rot = el("g", {}, g);
      const s = el("g", { transform: "translate(-11 -9) scale(0.85)" }, rot);
      el("rect", { class: "pg-env", x: 8.4, y: 12.6, width: 7.4, height: 5.2 }, s);
      el("path", { class: "pg-body", d: BODY }, s);
      el("path", { class: "wing", d: WING, style: `animation-delay:-${(p.packet * 0.37) % 1.1}s` }, s);
      const num = el("text", { class: "pg-num", x: 0, y: -10, "text-anchor": "middle" }, g);
      num.textContent = p.packet + 1;
      this.pgEls.set(p, { g, rot, off });
    });

    wrap.appendChild(svg);

    const exNote = document.createElement("p");
    exNote.className = "note";
    exNote.innerHTML = `Each <b>post office</b> (a router) only reads the address and hands the packet to a neighbour closer to the destination. Nobody plans the whole trip, so packets take different paths, wait in different queues and <b>arrive out of order</b>.<br>Sometimes a packet is <b>lost</b> (red ×). The sender never hears back, so after a timeout it sends a copy: a <b>retransmission</b> (red trail).`;
    wrap.appendChild(exNote);

    // envelope slots
    const ol = document.createElement("ol");
    ol.className = "slots";
    ol.setAttribute("aria-label", "Envelope slots");
    this.slots = [];
    for (let i = 0; i < n; i++) {
      const li = document.createElement("li");
      li.className = "slot" + (this.o.sealed ? " sealed" : "");
      li.innerHTML = `<svg viewBox="0 0 34 24" aria-hidden="true">
          <rect class="env" x="1" y="1" width="32" height="22"/>
          <polyline class="flap" points="1,1 17,13 33,1"/>
          <polyline class="tick" points="22,17 25.5,20.5 33,12"/>
          <line class="x" x1="12" y1="7" x2="22" y2="17"/><line class="x" x1="12" y1="17" x2="22" y2="7"/>
        </svg><span class="seq">${i + 1}/${n}</span><span class="sum"></span>`;
      ol.appendChild(li);
      this.slots.push({ li, sum: li.querySelector(".sum"), state: "" });
    }
    wrap.appendChild(ol);
    const n2 = document.createElement("p");
    n2.className = "note";
    n2.innerHTML = `As each packet lands, the receiver works out its <b>checksum</b> again. If it matches the one on the label, nothing was damaged: a tick.`;
    wrap.appendChild(n2);

    this.buf = document.createElement("p");
    this.buf.className = "buffer";
    this.buf.setAttribute("aria-live", "polite");
    wrap.appendChild(this.buf);
    const n3 = document.createElement("p");
    n3.className = "note";
    n3.innerHTML = `TCP only hands text over <b>in order</b>. If packet 4 is missing, packets 5, 6 and 7 wait in the <b>buffer</b> until it turns up.`;
    wrap.appendChild(n3);

    this.host.appendChild(wrap);
  }

  /** clock(): seconds since sending. */
  play(clock) {
    this.stop();
    this.clock = clock;
    this.prevT = null;
    const tick = () => {
      const t = this.clock();
      this.render(t);
      if (t < this.o.flight.total + 0.2) this.raf = requestAnimationFrame(tick);
      else { this.raf = 0; this.o.onEnd?.(); }
    };
    tick();
  }
  stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
  get running() { return !!this.raf; }

  render(t) {
    const { flight, n, sums } = this.o;
    const snap = reduceMotion.matches;
    const prev = this.prevT;
    let airborne = 0, waiting = 0;
    const busy = new Set();

    for (const p of flight.pigeons) {
      const e = this.pgEls.get(p);
      const pos = pigeonAt(p, t, snap);
      if (pos) {
        airborne++;
        if (pos.at && this.po[pos.at]) busy.add(pos.at);
        const ox = Math.sin(pos.ang) * -e.off, oy = Math.cos(pos.ang) * e.off;
        e.g.setAttribute("transform", `translate(${(pos.x + ox).toFixed(2)} ${(pos.y + oy).toFixed(2)})`);
        e.rot.setAttribute("transform", `rotate(${((pos.ang * 180) / Math.PI * 0.6).toFixed(1)})`);
        e.g.setAttribute("opacity", 1);
      } else {
        e.g.setAttribute("opacity", 0);
        if (t < p.start && !p.resend) waiting++;
      }
      if (prev != null && t - prev < 2) {
        if (prev < p.start && t >= p.start) sound.flap(p.resend ? 0.9 : 0.6);
        if (!p.lost && prev < p.end && t >= p.end) sound.flap(0.35);
      }
    }
    for (const k in this.po) this.po[k].classList.toggle("po-busy", busy.has(k));

    let resendNow = null;
    for (const [p, g] of this.lostMarks) g.setAttribute("opacity", t >= p.end ? 1 : 0);
    for (const [p, path] of this.reRoutes) {
      const on = t >= p.start && t < p.end + 6;
      path.classList.toggle("on", on);
      if (t >= p.start - 0.01 && t < p.start + 6) resendNow = p.packet + 1;
    }
    this.queueLabel.textContent = waiting ? waiting + " queued" : "";
    this.resendLabel.textContent = resendNow ? `timeout · resend ${resendNow}` : "";

    // packets & TCP in-order delivery
    const got = flight.arrive.map((a) => t >= a);
    let inOrder = 0;
    while (inOrder < n && got[inOrder]) inOrder++;
    const lostNow = new Set();
    for (const [p] of this.lostMarks) if (t >= p.end && !got[p.packet]) lostNow.add(p.packet);

    this.slots.forEach((s, i) => {
      const state = got[i] ? (i < inOrder ? "got" : "buf") : lostNow.has(i) ? "lost" : "";
      if (state === s.state) return;
      s.state = state;
      s.li.className = "slot" + (this.o.sealed ? " sealed" : "") + (state === "buf" ? " got buf" : state ? " " + state : "");
      s.sum.textContent = got[i] ? sums[i] : state === "lost" ? "lost" : "";
      s.li.title = got[i] ? `Packet ${i + 1}: checksum ${sums[i]} ok` : "";
    });

    const buffered = [];
    for (let i = inOrder; i < n; i++) if (got[i]) buffered.push(i + 1);
    const bufKey = inOrder + "|" + buffered.join(",");
    if (bufKey !== this.bufKey) {
      this.bufKey = bufKey;
      this.buf.innerHTML = buffered.length
        ? `Buffer · <span class="wait">${buffered.join(" ")}</span> waiting for <span class="miss">${inOrder + 1}</span>`
        : inOrder === n ? "Buffer · empty · all in order" : "Buffer · empty";
    }

    const done = inOrder === n;
    this.headL.textContent = done
      ? `All ${n} packets delivered`
      : airborne
        ? `${airborne} ${airborne === 1 ? "pigeon" : "pigeons"} in flight`
        : waiting ? "Waiting to take off" : "In flight";
    this.headR.textContent = `${mmss(Math.min(t, flight.total))} / ${mmss(flight.total)}`;

    const key = inOrder + "|" + got.join("") + "|" + airborne + "|" + done;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.o.onState?.({ t, got, inOrder, airborne, waiting, done, buffered });
    }
    this.prevT = t;
  }
}

function trim(s, max) { return s.length > max ? s.slice(0, max - 1) + "…" : s; }
export { html, mmss };
