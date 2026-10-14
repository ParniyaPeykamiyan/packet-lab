import {
  canLock, seal, unseal, encodeLetter, decodeLetter,
  packetCount, splitText, packetSums, MAX_CHARS,
} from "./codec.js";
import { buildFlight, TAKEOFF } from "./flight.js";
import { FlightView, html } from "./view.js";
import * as sound from "./sound.js";

const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const fmtTime = (ms) => new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));

let views = [];
let timers = [];
function teardown() {
  views.forEach((v) => v.stop());
  views = [];
  timers.forEach(clearTimeout);
  timers = [];
}
const later = (fn, ms) => timers.push(setTimeout(fn, ms));
function show(id) {
  for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== id;
  window.scrollTo(0, 0);
}

/* ---------- toggles ---------- */
const explainBtn = $("explainToggle");
function setExplain(on) {
  document.body.classList.toggle("explain", on);
  explainBtn.setAttribute("aria-pressed", on);
  store.set("pl-explain", on ? "1" : "0");
}
explainBtn.addEventListener("click", () => setExplain(!document.body.classList.contains("explain")));
setExplain(store.get("pl-explain") === "1");

const soundBtn = $("soundToggle");
soundBtn.addEventListener("click", async () => {
  if (sound.isOn()) { sound.disable(); soundBtn.setAttribute("aria-pressed", "false"); return; }
  const ok = await sound.enable();
  soundBtn.setAttribute("aria-pressed", ok ? "true" : "false");
});

/* ---------- send ---------- */
const form = $("sendForm");
const msg = $("message");
const count = $("count");
const lockOn = $("lockOn");
const pwField = $("pwField");

function updateCount() {
  count.textContent = `${msg.value.length} / ${MAX_CHARS}`;
  count.classList.toggle("full", msg.value.length >= MAX_CHARS);
}
msg.addEventListener("input", updateCount);
lockOn.addEventListener("change", () => {
  pwField.hidden = !lockOn.checked;
  if (lockOn.checked) $("password").focus();
});

function showSend(prefill = {}) {
  teardown();
  $("compose").hidden = false;
  $("dispatch").hidden = true;
  if (prefill.from != null) $("fromName").value = prefill.from;
  if (prefill.to != null) $("toName").value = prefill.to;
  if (prefill.clear) { msg.value = ""; $("password").value = ""; lockOn.checked = false; pwField.hidden = true; }
  updateCount();
  $("sendError").textContent = "";
  show("send");
  document.title = "Packet Lab";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("sendError");
  const from = $("fromName").value.trim();
  const to = $("toName").value.trim();
  const text = msg.value.trim();
  const pw = $("password").value;
  err.textContent = "";
  if (!from) return fail("Add your name.", "fromName");
  if (!to) return fail("Add your friend’s name.", "toName");
  if (!text) return fail("Write a message first.", "message");
  if (lockOn.checked && !canLock) return fail("Password lock needs a secure (https) page.");
  if (lockOn.checked && !pw) return fail("Choose a password, or untick the lock.", "password");

  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = lockOn.checked ? "Sealing…" : "Folding…";
  try {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const n = packetCount(Array.from(text).length);
    const sealed = lockOn.checked ? await seal(text, pw) : null;
    const letter = { from, to, ts: Date.now(), seed, n, text: sealed ? undefined : text, sealed };
    const frag = await encodeLetter(letter);
    const url = location.origin + location.pathname + "#" + frag;
    dispatch(letter, text, url);
  } catch (ex) {
    console.error(ex);
    fail("Something went wrong folding the letter. Try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Send by pigeon";
  }

  function fail(m, focusId) {
    err.textContent = m;
    if (focusId) $(focusId).focus();
  }
});

function dispatch(letter, text, url) {
  teardown();
  const { n, from, to } = letter;
  const chunks = splitText(text, n);
  const sums = packetSums(letter);
  const flight = buildFlight(letter.seed, n);
  const quick = reduceMotion.matches;

  $("compose").hidden = true;
  $("dispatch").hidden = false;
  $("linkBox").hidden = true;
  window.scrollTo(0, 0);

  const status = $("dispatchStatus");
  const title = $("dispatchTitle");
  status.textContent = `Par avion · ${n} ${n === 1 ? "packet" : "packets"}`;
  title.textContent = `Cutting your letter into ${n} ${n === 1 ? "packet" : "packets"}`;

  const grid = $("packetGrid");
  grid.hidden = false;
  grid.innerHTML = chunks.map((c, i) => `
    <li class="pkt">
      <span class="stamp" aria-hidden="true"></span>
      <span class="seq">${i + 1}/${n}</span>
      <div class="hdr">from <b>${html(from)}</b><br>to <b>${html(to)}</b><br>sum <b>${sums[i]}</b></div>
      <p class="bit">${letter.sealed ? "sealed" : "“" + html(c.trim() || "·") + "”"}</p>
    </li>`).join("");
  const items = [...grid.children];
  items.forEach((li, i) => later(() => li.classList.add("in"), quick ? 0 : 120 + i * 130));

  // the sender watches the same flight
  const view = new FlightView($("senderFlight"), {
    n, from, to, sums, flight, sealed: !!letter.sealed,
    onState(s) {
      if (s.done) {
        status.textContent = `Par avion · all ${n} delivered`;
        title.innerHTML = `Delivered <em>to ${html(to)}.</em>`;
      } else if (s.airborne) {
        status.textContent = `Par avion · ${s.airborne} ${s.airborne === 1 ? "packet" : "packets"} in flight`;
        if (grid.hidden) title.innerHTML = `In flight <em>to ${html(to)}.</em>`;
      }
    },
  });
  views.push(view);
  view.play(() => (Date.now() - letter.ts) / 1000);

  // envelopes are picked up at take-off
  const wait = Math.max(0, TAKEOFF * 1000 - (Date.now() - letter.ts));
  later(() => {
    title.textContent = "Pigeons are picking them up";
    items.forEach((li, i) => later(() => li.classList.add("away"), quick ? 0 : i * 90));
    later(() => {
      grid.hidden = true;
      title.innerHTML = `In flight <em>to ${html(to)}.</em>`;
      showLink(letter, url);
    }, quick ? 0 : 1500 + items.length * 90);
  }, Math.max(wait, quick ? 0 : 900 + n * 130));
}

function showLink(letter, url) {
  $("linkBox").hidden = false;
  const out = $("linkOut");
  out.value = url;
  $("privacyNote").innerHTML = letter.sealed
    ? `<b>Password-locked.</b> Send the password some other way, not next to the link. The letter lives only after the # in the link, which is never sent to a server.`
    : `Anyone with this link can read the message, unless it’s password-locked. The letter lives only after the # in the link, which is never sent to a server.`;

  const copy = $("copyBtn");
  copy.textContent = "Copy link";
  copy.onclick = async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch {
      out.select();
      try { ok = document.execCommand("copy"); } catch {}
    }
    copy.textContent = ok ? "Copied" : "Select and copy";
    later(() => (copy.textContent = "Copy link"), 2200);
  };
  const share = $("shareBtn");
  share.hidden = !navigator.share;
  share.onclick = () => navigator.share({
    title: "A letter by pigeon",
    text: `${letter.from} sent you a letter by pigeon.`,
    url,
  }).catch(() => {});
}
$("newBtn").addEventListener("click", () => { history.replaceState(null, "", location.pathname); routed = ""; showSend({ clear: true }); });
$("linkOut").addEventListener("focus", (e) => e.target.select());

/* ---------- receive ---------- */
const SEAL_SVG = `<svg viewBox="0 0 120 82" aria-hidden="true">
  <rect x="1" y="1" width="118" height="80" fill="none" stroke="currentColor" stroke-width="1"/>
  <polyline points="1,1 60,46 119,1" fill="none" stroke="currentColor" stroke-width="1"/>
  <circle cx="60" cy="46" r="11" fill="var(--red)"/>
  <circle cx="60" cy="46" r="6.5" fill="none" stroke="var(--paper)" stroke-width=".8"/></svg>`;

function postmarkSVG(ms) {
  const d = new Date(ms);
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(d).toUpperCase();
  const hm = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(d);
  const waves = [-14, -5, 4, 13].map((y) => `<path class="pm-ring" stroke-width="1.1" d="M48 ${y} q 8 -5 16 0 t 16 0 t 16 0 t 16 0 t 16 0"/>`).join("");
  return `<svg viewBox="-60 -60 120 120" aria-label="Postmark: delivered ${day} ${d.getFullYear()}">
    ${waves}
    <circle class="pm-ring" r="45" stroke-width="1.6"/>
    <circle class="pm-ring" r="31" stroke-width=".8"/>
    <path id="pmArc" d="M -38 0 A 38 38 0 1 1 38 0 A 38 38 0 1 1 -38 0" fill="none"/>
    <text font-size="7.4" letter-spacing="1.55"><textPath href="#pmArc">PACKET LAB · DELIVERED · PAR AVION ·</textPath></text>
    <text y="-3" text-anchor="middle" font-size="10.5" font-weight="500">${day}</text>
    <text y="9" text-anchor="middle" font-size="7.5">${d.getFullYear()}</text>
    <text y="19" text-anchor="middle" font-size="6.5">${html(hm)}</text></svg>`;
}

function showReceive(letter) {
  teardown();
  const { n, from, to, ts } = letter;
  const flight = buildFlight(letter.seed, n);
  const sums = packetSums(letter);
  let chunks = letter.text != null ? splitText(letter.text, n) : null;
  let last = null;     // last flight state
  let live = false;    // watching pigeons arrive (vs. opened after delivery)
  let stamped = false;

  show("receive");
  document.title = `A letter from ${from} · Packet Lab`;
  $("rxTitle").innerHTML = `A letter <em>from ${html(from)}</em>`;
  $("rxMeta").textContent = `To ${to} · sent ${fmtTime(ts)}${letter.sealed ? " · sealed" : ""}`;
  $("letterTo").textContent = `${to},`;
  $("letterFrom").textContent = `— ${from}`;
  const pm = $("postmark");
  pm.hidden = true;
  pm.classList.remove("stamp");
  pm.innerHTML = postmarkSVG(ts + flight.total * 1000);
  const replayBtn = $("replayBtn");
  const replyBtn = $("replyBtn");
  replayBtn.hidden = true;
  replyBtn.hidden = true;

  // letter body: one span per packet, shown only in order
  const body = $("letterBody");
  let spans = [];
  function buildBody() {
    body.innerHTML = "";
    spans = chunks.map(() => {
      const s = document.createElement("span");
      s.dataset.state = "";
      body.appendChild(s);
      return s;
    });
  }
  function buildSeal() {
    body.innerHTML = `<div class="sealed-box">${SEAL_SVG}
      <p>Sealed. Enter the password to open it.</p>
      <form id="unsealForm" novalidate>
        <label class="field"><span class="label">Password</span>
          <input id="unsealPw" type="password" autocomplete="off"></label>
        <button class="btn primary" type="submit">Break the seal</button>
        <p class="error" id="unsealErr" role="alert"></p>
      </form></div>`;
    $("unsealForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector("button");
      const err = $("unsealErr");
      err.textContent = "";
      btn.disabled = true;
      btn.textContent = "Breaking…";
      const text = await unseal(letter.sealed, $("unsealPw").value);
      btn.disabled = false;
      btn.textContent = "Break the seal";
      if (text == null) { err.textContent = "The seal won’t break."; $("unsealPw").select(); return; }
      chunks = splitText(text, n);
      buildBody();
      update();
    });
  }
  if (chunks) buildBody(); else buildSeal();

  function update() {
    const s = last;
    if (!s) return;
    const status = $("rxStatus");
    status.innerHTML = s.done
      ? `Par avion · all ${n} packets delivered`
      : s.airborne
        ? `Par avion · <span class="hot">${s.airborne}</span> ${s.airborne === 1 ? "packet" : "packets"} in flight`
        : "Par avion · waiting to take off";
    if (chunks) {
      chunks.forEach((c, i) => {
        const sp = spans[i];
        const st = i < s.inOrder ? "shown" : "gap";
        if (sp.dataset.state === st) return;
        sp.dataset.state = st;
        if (st === "shown") { sp.className = live ? "chunk" : ""; sp.textContent = c; }
        else { sp.className = "gap"; sp.textContent = c.replace(/\S/g, " "); }
      });
    }
    if (s.done) {
      if (chunks && !stamped) {
        stamped = true;
        pm.hidden = false;
        if (live) {
          pm.classList.remove("stamp");
          void pm.offsetWidth;
          pm.classList.add("stamp");
          setTimeout(() => sound.thud(), reduceMotion.matches ? 0 : 420);
        }
        replyBtn.hidden = false;
      }
    }
  }

  const view = new FlightView($("rxFlight"), {
    n, from, to, sums, flight, sealed: !!letter.sealed,
    onState(s) { last = s; update(); },
    onEnd() { replayBtn.hidden = false; },
  });
  views.push(view);

  // A clock that is badly ahead of the sender's would make the letter arrive "in the future".
  const skewed = ts > Date.now() + 60_000;
  const opened = Date.now();
  const elapsed = (Date.now() - ts) / 1000;
  if (!skewed && elapsed >= flight.total) {
    view.render(flight.total + 1);
    replayBtn.hidden = false;
  } else {
    live = true;
    view.play(() => Math.max(0, skewed ? (Date.now() - opened) / 1000 : (Date.now() - ts) / 1000));
  }

  replayBtn.onclick = () => {
    live = true;
    stamped = false;
    pm.hidden = true;
    pm.classList.remove("stamp");
    if (chunks) buildBody();
    replayBtn.hidden = true;
    const start = performance.now();
    view.play(() => (performance.now() - start) / 1000);
    $("rxFlight").scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
  };
  replyBtn.onclick = () => {
    history.pushState(null, "", location.pathname);
    routed = "";
    showSend({ from: to, to: from, clear: true });
    msg.focus();
  };
}

/* ---------- routing ---------- */
let routed = null;
async function route() {
  const frag = location.hash.slice(1);
  if (frag === routed) return;
  routed = frag;
  if (!frag) return showSend();
  try {
    const letter = await decodeLetter(frag);
    showReceive(letter);
  } catch (e) {
    console.warn(e);
    teardown();
    show("broken");
  }
}
window.addEventListener("hashchange", route);
window.addEventListener("popstate", route);
route();
