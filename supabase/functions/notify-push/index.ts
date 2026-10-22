/**
 * notify-push: kirim system notif (FCM HTTP v1) ke anggota room selain pengirim.
 * Input : { message_id } - dipanggil klien setelah pesan tersimpan (fire-and-forget).
 * Auth : JWT sesi pengguna (deploy --no-verify-jwt; verifikasi manual di sini)
 *        + HANYA pengirim pesan yang boleh memicu (mencegah spam notifikasi).
 * Secret: FCM_SERVICE_ACCOUNT_JSON = isi file service account Firebase
 *         (Project Settings -> Service Accounts -> Generate new private key).
 * Preview pesan dihormati per perangkat via device_tokens.settings.messagePreview.
 */
import { adminClient } from "../_shared/supabase.ts";
import { errorJson, json, preflight } from "../_shared/respond.ts";

const PREVIEW_MAX = 120;
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

type Account = {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri: string;
};

function loadAccount(): Account | null {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.client_email && parsed?.private_key && parsed?.token_uri) {
      return parsed as Account;
    }
  } catch { /* bukan JSON valid */ }
  return null;
}

function b64url(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** Ambil DER (PKCS#8) dari kunci PEM service account. */
function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out.buffer;
}

/** Tanda tangan JWT (RS256) utk menukar access token OAuth2 Google. */
async function signAssertion(account: Account): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(enc.encode(JSON.stringify({
    iss: account.client_email,
    scope: FCM_SCOPE,
    aud: account.token_uri,
    iat: now,
    exp: now + 3600,
  })));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(unsigned));
  return `${unsigned}.${b64url(signature)}`;
}

async function getAccessToken(account: Account): Promise<string> {
  const assertion = await signAssertion(account);
  const res = await fetch(account.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:
      `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) {
    throw new Error(`Gagal menukar access token FCM (HTTP ${res.status}).`);
  }
  return body.access_token as string;
}

async function sendOne(
  accessToken: string,
  account: Account,
  token: string,
  title: string,
  bodyText: string,
  chatId: string,
): Promise<{ ok: boolean; invalid: boolean }> {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body: bodyText },
          data: { chatId },
          android: { priority: "high" },
        },
      }),
    },
  );
  if (res.ok) return { ok: true, invalid: false };
  const err = await res.json().catch(() => null);
  const status = err?.error?.status || "";
  const invalid = ["NOT_FOUND", "INVALID_ARGUMENT", "UNREGISTERED"].includes(status);
  return { ok: false, invalid };
}

function previewOf(rawBody: unknown): string {
  const collapsed = String(rawBody ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) return "Pesan baru";
  return collapsed.length > PREVIEW_MAX
    ? `${collapsed.slice(0, PREVIEW_MAX - 1)}…`
    : collapsed;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorJson("Method tidak diizinkan", 405, "METHOD");

  try {
    const body = await req.json().catch(() => null);
    const messageId = String(body?.message_id ?? "");
    if (!/^[0-9a-fA-F-]{16,64}$/.test(messageId)) {
      return errorJson("message_id tidak valid.", 400, "VALIDATION");
    }

    const account = loadAccount();
    if (!account) {
      return errorJson(
        "Konfigurasi FCM belum lengkap - set secret FCM_SERVICE_ACCOUNT_JSON (lihat docs/10).",
        503,
        "CONFIG",
      );
    }

    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return errorJson("Sesi dibutuhkan.", 401, "UNAUTHENTICATED");

    const admin = adminClient();
    const { data: authData, error: authErr } = await admin.auth.getUser(jwt);
    const uid = authData?.user?.id;
    if (authErr || !uid) return errorJson("Sesi tidak valid.", 401, "UNAUTHENTICATED");

    const { data: msg, error: msgErr } = await admin
      .from("messages")
      .select("id, room_id, sender_id, body")
      .eq("id", messageId)
      .maybeSingle();
    if (msgErr) return errorJson("Gagal memuat pesan.", 500, "DB_ERROR");
    if (!msg) return errorJson("Pesan tidak ditemukan.", 404, "NOT_FOUND");
    if (msg.sender_id !== uid) {
      return errorJson("Hanya pengirim pesan yang boleh mengirim notifikasi.", 403, "FORBIDDEN");
    }

    const { data: members, error: memErr } = await admin
      .from("chat_room_members")
      .select("user_id")
      .eq("room_id", msg.room_id);
    if (memErr) return errorJson("Gagal memuat anggota room.", 500, "DB_ERROR");
    const recipients = (members || []).map((m) => m.user_id).filter((id) => id !== uid);
    if (!recipients.length) return json({ sent: 0, recipients: 0 });

    const { data: tokenRows, error: tokErr } = await admin
      .from("device_tokens")
      .select("id, token, settings")
      .in("user_id", recipients);
    if (tokErr) return errorJson("Gagal memuat token perangkat.", 500, "DB_ERROR");
    const tokens = tokenRows || [];
    if (!tokens.length) return json({ sent: 0, recipients: recipients.length });

    const { data: sender } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", uid)
      .maybeSingle();
    const title = (sender?.display_name || "KLIK").trim().slice(0, 60) || "KLIK";
    const fullPreview = previewOf(msg.body);

    const accessToken = await getAccessToken(account);
    const results = await Promise.all(
      tokens.map(async (row) => {
        const text = row.settings?.messagePreview === false ? "Pesan baru" : fullPreview;
        const res = await sendOne(accessToken, account, row.token, title, text, msg.room_id);
        return { row, res };
      }),
    );

    let sent = 0;
    const invalidIds: string[] = [];
    for (const { row, res } of results) {
      if (res.ok) sent += 1;
      else if (res.invalid) invalidIds.push(row.id);
    }
    // Token yang sudah tidak valid / di-uninstall -> bersihkan dari tabel.
    if (invalidIds.length) {
      await admin.from("device_tokens").delete().in("id", invalidIds);
    }
    return json({ sent, recipients: recipients.length, invalidRemoved: invalidIds.length });
  } catch (error) {
    return errorJson(
      error instanceof Error ? error.message : "Gagal mengirim notifikasi.",
      500,
      "PUSH_ERROR",
    );
  }
});
