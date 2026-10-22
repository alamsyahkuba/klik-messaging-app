/**
 * Kripto untuk Edge Functions KLIK.
 * - PBKDF2-SHA256 (600.000 iterasi) untuk hash passphrase & recovery key
 * - HMAC-SHA256(AUTH_PEPPER, passphrase) sebagai password akun Supabase Auth
 *   internal (memetakan kredensial -> sesi Supabase tanpa menyimpan plaintext)
 * Format hash: pbkdf2$sha256$<iter>$<salt_b64>$<hash_b64>
 */
const te = new TextEncoder();
const PBKDF2_ITERATIONS = 600_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // tanpa I, O, 0, 1

export function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pbkdf2(secret: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", te.encode(secret), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(secret, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const parts = (stored || "").split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;
  const iterations = Number(parts[2]);
  if (!Number.isFinite(iterations) || iterations < 100000) return false;
  const salt = fromB64(parts[3]);
  const expected = fromB64(parts[4]);
  const actual = await pbkdf2(secret, salt, iterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

export async function deriveSessionPassword(passphrase: string): Promise<string> {
  const pepper = Deno.env.get("AUTH_PEPPER");
  if (!pepper) throw new Error("AUTH_PEPPER belum di-set (supabase secrets set AUTH_PEPPER=...)");
  const key = await crypto.subtle.importKey(
    "raw",
    te.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(`klik-session-v1:${passphrase}`));
  return toHex(new Uint8Array(sig));
}

function randomBlock(len = 4): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function generatePublicCode(): string {
  return `KLIK-${randomBlock()}-${randomBlock()}`;
}

export function generateRecoveryKey(): string {
  return `RCV-${randomBlock()}-${randomBlock()}-${randomBlock()}-${randomBlock()}`;
}

/**
 * Normalisasi input menjadi format kanonik tersimpan di DB.
 * DB menyimpan "KLIK-XXXX-XXXX" dan "RCV-XXXX-XXXX-XXXX-XXXX" (pakai tanda minus),
 * jadi hasil normalisasi WAJIB direkonstruksi dengan minus agar hash/lookup cocok.
 * Mengembalikan string kosong bila format tidak valid.
 */
export function normalizeAccountCode(input: unknown): string {
  const raw = String(input ?? "").trim().toUpperCase().replace(/[\s-]/g, "");
  if (!/^KLIK[A-Z0-9]{8}$/.test(raw)) return "";
  return `KLIK-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export function normalizeRecoveryKey(input: unknown): string {
  const raw = String(input ?? "").trim().toUpperCase().replace(/[\s-]/g, "");
  if (!/^RCV[A-Z0-9]{16}$/.test(raw)) return "";
  const b = raw.slice(3);
  return `RCV-${b.slice(0, 4)}-${b.slice(4, 8)}-${b.slice(8, 12)}-${b.slice(12, 16)}`;
}
