// Everything a letter needs lives in the URL fragment (after #),
// which browsers never send to the server.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const MAX_CHARS = 1000;
export const MAX_PACKETS = 12;
const PBKDF2_ROUNDS = 250000;

export const canCompress = typeof CompressionStream === "function";
export const canLock = !!(globalThis.crypto && crypto.subtle);

/* ---------- bytes <-> base64url ---------- */
export function toB64url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64url(str) {
  if (!/^[A-Za-z0-9_-]*$/.test(str)) throw new Error("bad base64");
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------- compression ---------- */
async function pipe(bytes, stream) {
  const s = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}
export const deflate = (b) => pipe(b, new CompressionStream("deflate-raw"));
export const inflate = (b) => pipe(b, new DecompressionStream("deflate-raw"));

/* ---------- password seal (AES-GCM, PBKDF2 key) ---------- */
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ROUNDS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function seal(text, password) {
  const salt = rand(16);
  const iv = rand(12);
  const key = await deriveKey(password, salt);
  let data = enc.encode(text);
  if (canCompress) data = await deflate(data);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
  return { salt, iv, ct, z: canCompress ? 1 : 0 };
}

/** Returns the text, or null if the password is wrong. */
export async function unseal(sealed, password) {
  let data;
  try {
    const key = await deriveKey(password, sealed.salt);
    data = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv }, key, sealed.ct));
  } catch {
    return null;
  }
  if (sealed.z) data = await inflate(data);
  return dec.decode(data);
}

/* ---------- packets ---------- */
export function packetCount(len) {
  return Math.max(1, Math.min(MAX_PACKETS, Math.max(Math.min(len, 4), Math.ceil(len / 24))));
}

/** Cut text into n pieces of roughly equal length (by code point). */
export function splitText(text, n) {
  const cps = Array.from(text);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(cps.slice(Math.floor((i * cps.length) / n), Math.floor(((i + 1) * cps.length) / n)).join(""));
  }
  return out;
}

export function splitBytes(bytes, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(bytes.subarray(Math.floor((i * bytes.length) / n), Math.floor(((i + 1) * bytes.length) / n)));
  }
  return out;
}

/** Fletcher-16: a small checksum, shown as 4 hex digits. */
export function checksum(bytes) {
  if (typeof bytes === "string") bytes = enc.encode(bytes);
  let a = 0, b = 0;
  for (const x of bytes) { a = (a + x) % 255; b = (b + a) % 255; }
  return ((b << 8) | a).toString(16).padStart(4, "0");
}

/** The per-packet payload checksums both ends can compute before unsealing. */
export function packetSums(letter) {
  const pieces = letter.sealed ? splitBytes(letter.sealed.ct, letter.n) : splitText(letter.text, letter.n);
  return pieces.map(checksum);
}

/* ---------- the link ---------- */
export async function encodeLetter(l) {
  const o = { v: 1, f: l.from, t: l.to, ts: l.ts, sd: l.seed, n: l.n };
  if (l.sealed) o.k = [toB64url(l.sealed.salt), toB64url(l.sealed.iv), toB64url(l.sealed.ct), l.sealed.z];
  else o.m = l.text;
  const json = enc.encode(JSON.stringify(o));
  return canCompress ? "1" + toB64url(await deflate(json)) : "0" + toB64url(json);
}

export async function decodeLetter(frag) {
  const kind = frag[0];
  let bytes = fromB64url(frag.slice(1));
  if (kind === "1") bytes = await inflate(bytes);
  else if (kind !== "0") throw new Error("unknown format");
  const o = JSON.parse(dec.decode(bytes));
  const str = (x, max) => typeof x === "string" && x.length <= max;
  if (o.v !== 1 || !str(o.f, 40) || !str(o.t, 40)) throw new Error("bad letter");
  if (!Number.isFinite(o.ts) || !Number.isInteger(o.sd)) throw new Error("bad letter");
  if (!Number.isInteger(o.n) || o.n < 1 || o.n > MAX_PACKETS) throw new Error("bad letter");
  const letter = { from: o.f, to: o.t, ts: o.ts, seed: o.sd >>> 0, n: o.n };
  if (Array.isArray(o.k)) {
    letter.sealed = { salt: fromB64url(o.k[0]), iv: fromB64url(o.k[1]), ct: fromB64url(o.k[2]), z: o.k[3] ? 1 : 0 };
  } else if (str(o.m, MAX_CHARS * 2)) {
    letter.text = o.m;
  } else throw new Error("bad letter");
  return letter;
}
