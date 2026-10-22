/**
 * auth-recover: pulihkan akun memakai recovery key (tanpa email/telepon).
 * Input : { public_code, recovery_key, new_passphrase }
 * Output: { session, profile, recovery_key }  <- recovery key BARU (rotasi)
 * Setelah pemulihan: passphrase lama & recovery key lama tidak berlaku lagi.
 */
import { adminClient } from "../_shared/supabase.ts";
import { errorJson, json, preflight } from "../_shared/respond.ts";
import {
  deriveSessionPassword,
  generateRecoveryKey,
  hashSecret,
  normalizeAccountCode,
  normalizeRecoveryKey,
  verifySecret,
} from "../_shared/crypto.ts";

const CODE_RE = /^KLIK-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const RECOVERY_RE = /^RCV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorJson("Method tidak diizinkan", 405, "METHOD");

  try {
    const body = await req.json().catch(() => null);
    const code = normalizeAccountCode(body?.public_code);
    const recoveryKey = normalizeRecoveryKey(body?.recovery_key);
    const newPassphrase = String(body?.new_passphrase ?? "");

    if (!CODE_RE.test(code)) {
      return errorJson("Format kode akun tidak valid.", 400, "VALIDATION");
    }
    if (!RECOVERY_RE.test(recoveryKey)) {
      return errorJson("Format recovery key tidak valid.", 400, "VALIDATION");
    }
    if (newPassphrase.length < 8 || newPassphrase.length > 128) {
      return errorJson("Passphrase baru harus 8-128 karakter.", 400, "VALIDATION");
    }

    const admin = adminClient();
    const genericError = "Kode akun atau recovery key salah.";

    const { data: profile } = await admin
      .from("profiles")
      .select("id, display_name, public_code")
      .eq("public_code", code)
      .maybeSingle();
    if (!profile) return errorJson(genericError, 401, "INVALID_RECOVERY");

    const { data: cred } = await admin
      .from("account_credentials")
      .select("auth_email, recovery_hash")
      .eq("user_id", profile.id)
      .maybeSingle();
    if (!cred) return errorJson(genericError, 401, "INVALID_RECOVERY");

    const recoveryOk = await verifySecret(recoveryKey, cred.recovery_hash);
    if (!recoveryOk) return errorJson(genericError, 401, "INVALID_RECOVERY");

    // Rotasi: passphrase baru + recovery key baru
    const rotatedRecoveryKey = generateRecoveryKey();
    const sessionPassword = await deriveSessionPassword(newPassphrase);

    const { error: updateCredErr } = await admin
      .from("account_credentials")
      .update({
        secret_hash: await hashSecret(newPassphrase),
        recovery_hash: await hashSecret(rotatedRecoveryKey),
        secret_updated_at: new Date().toISOString(),
      })
      .eq("user_id", profile.id);
    if (updateCredErr) {
      return errorJson("Gagal memperbarui kredensial.", 500, "DB_ERROR");
    }

    const { error: updateAuthErr } = await admin.auth.admin.updateUserById(profile.id, {
      password: sessionPassword,
    });
    if (updateAuthErr) {
      return errorJson("Gagal memperbarui sesi autentikasi.", 500, "AUTH_UPDATE");
    }

    const { data: signed, error: sessionErr } = await admin.auth.signInWithPassword({
      email: cred.auth_email,
      password: sessionPassword,
    });
    if (sessionErr || !signed.session) {
      return errorJson("Gagal membuat sesi. Coba masuk manual.", 500, "SESSION");
    }

    return json({
      session: {
        access_token: signed.session.access_token,
        refresh_token: signed.session.refresh_token,
        expires_at: signed.session.expires_at,
      },
      profile,
      recovery_key: rotatedRecoveryKey,
    });
  } catch (e) {
    return errorJson(`Kesalahan server: ${(e as Error).message}`, 500, "SERVER");
  }
});
