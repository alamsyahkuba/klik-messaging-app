/**
 * auth-login: masuk dengan kode akun publik + passphrase.
 * Input : { public_code, passphrase }
 * Output: { session, profile }
 * Throttle: maksimal 10 percobaan gagal per kode dalam 15 menit (tabel login_attempts).
 * Pesan error sengaja sama untuk kode tidak dikenal & passphrase salah.
 */
import { adminClient } from "../_shared/supabase.ts";
import { errorJson, json, preflight } from "../_shared/respond.ts";
import {
  deriveSessionPassword,
  normalizeAccountCode,
  verifySecret,
} from "../_shared/crypto.ts";

const CODE_RE = /^KLIK-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const MAX_FAILS = 10;
const WINDOW_MINUTES = 15;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorJson("Method tidak diizinkan", 405, "METHOD");

  try {
    const body = await req.json().catch(() => null);
    const code = normalizeAccountCode(body?.public_code);
    const passphrase = String(body?.passphrase ?? "");

    if (!CODE_RE.test(code)) {
      return errorJson("Format kode akun tidak valid.", 400, "VALIDATION");
    }
    if (passphrase.length < 8 || passphrase.length > 128) {
      return errorJson("Passphrase harus 8-128 karakter.", 400, "VALIDATION");
    }

    const admin = adminClient();
    const genericError = "Kode akun atau passphrase salah.";

    const { count: fails } = await admin
      .from("login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("public_code", code)
      .eq("success", false)
      .gte("attempted_at", new Date(Date.now() - WINDOW_MINUTES * 60000).toISOString());
    if ((fails ?? 0) >= MAX_FAILS) {
      return errorJson(
        `Terlalu banyak percobaan gagal. Coba lagi dalam ${WINDOW_MINUTES} menit.`,
        429,
        "RATE_LIMITED",
      );
    }

    const recordAttempt = async (success: boolean) => {
      await admin.from("login_attempts").insert({ public_code: code, success });
    };

    const { data: profile } = await admin
      .from("profiles")
      .select("id, display_name, public_code")
      .eq("public_code", code)
      .maybeSingle();
    if (!profile) {
      await recordAttempt(false);
      return errorJson(genericError, 401, "INVALID_CREDENTIALS");
    }

    const { data: cred } = await admin
      .from("account_credentials")
      .select("auth_email, secret_hash")
      .eq("user_id", profile.id)
      .maybeSingle();
    if (!cred) {
      await recordAttempt(false);
      return errorJson(genericError, 401, "INVALID_CREDENTIALS");
    }

    const secretOk = await verifySecret(passphrase, cred.secret_hash);
    if (!secretOk) {
      await recordAttempt(false);
      return errorJson(genericError, 401, "INVALID_CREDENTIALS");
    }

    const { data: signed, error: sessionErr } = await admin.auth.signInWithPassword({
      email: cred.auth_email,
      password: await deriveSessionPassword(passphrase),
    });
    if (sessionErr || !signed.session) {
      await recordAttempt(false);
      return errorJson(genericError, 401, "INVALID_CREDENTIALS");
    }

    await recordAttempt(true);
    return json({
      session: {
        access_token: signed.session.access_token,
        refresh_token: signed.session.refresh_token,
        expires_at: signed.session.expires_at,
      },
      profile,
    });
  } catch (e) {
    return errorJson(`Kesalahan server: ${(e as Error).message}`, 500, "SERVER");
  }
});
