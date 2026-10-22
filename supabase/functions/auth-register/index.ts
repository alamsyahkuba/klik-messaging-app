/**
 * auth-register: buat akun tanpa email/telepon.
 * Input : { display_name, passphrase }
 * Output: { session, profile, recovery_key }  <- recovery_key hanya dikirim SEKALI
 * Alur  : admin.createUser (email internal acak) -> profiles + account_credentials
 *         -> signInWithPassword (password = HMAC(AUTH_PEPPER, passphrase)).
 * Deploy: supabase functions deploy auth-register --no-verify-jwt
 */
import { adminClient } from "../_shared/supabase.ts";
import { errorJson, json, preflight } from "../_shared/respond.ts";
import {
  deriveSessionPassword,
  generatePublicCode,
  generateRecoveryKey,
  hashSecret,
} from "../_shared/crypto.ts";

const NAME_RE = /^[\p{L}\p{N} ._'-]+$/u;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorJson("Method tidak diizinkan", 405, "METHOD");

  try {
    const body = await req.json().catch(() => null);
    const displayName = String(body?.display_name ?? "").trim();
    const passphrase = String(body?.passphrase ?? "");

    if (displayName.length < 2 || displayName.length > 30 || !NAME_RE.test(displayName)) {
      return errorJson("Nama tampilan harus 2-30 karakter (huruf, angka, spasi, . _ ' -).", 400, "VALIDATION");
    }
    if (passphrase.length < 8 || passphrase.length > 128) {
      return errorJson("Passphrase harus 8-128 karakter.", 400, "VALIDATION");
    }

    const admin = adminClient();
    const authEmail = `u-${crypto.randomUUID()}@auth.klik.internal`;
    const sessionPassword = await deriveSessionPassword(passphrase);

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: authEmail,
      password: sessionPassword,
      email_confirm: true,
      app_metadata: { provider: "klik-credentials" },
    });
    if (createErr || !created?.user) {
      return errorJson("Gagal membuat akun autentikasi.", 500, "AUTH_CREATE");
    }
    const userId = created.user.id;

    let publicCode = "";
    let profileSaved = false;
    for (let attempt = 0; attempt < 6 && !profileSaved; attempt += 1) {
      publicCode = generatePublicCode();
      const { error } = await admin
        .from("profiles")
        .insert({ id: userId, display_name: displayName, public_code: publicCode });
      if (!error) profileSaved = true;
      else if (!String(error.message).toLowerCase().includes("duplicate")) {
        await admin.auth.admin.deleteUser(userId);
        return errorJson("Gagal menyimpan profil.", 500, "DB_ERROR");
      }
    }
    if (!profileSaved) {
      await admin.auth.admin.deleteUser(userId);
      return errorJson("Gagal membuat kode akun unik. Coba lagi.", 500, "CODE_GEN");
    }

    const recoveryKey = generateRecoveryKey();
    const { error: credErr } = await admin.from("account_credentials").insert({
      user_id: userId,
      auth_email: authEmail,
      secret_hash: await hashSecret(passphrase),
      recovery_hash: await hashSecret(recoveryKey),
    });
    if (credErr) {
      await admin.auth.admin.deleteUser(userId);
      return errorJson("Gagal menyimpan kredensial.", 500, "DB_ERROR");
    }

    const { data: signed, error: sessionErr } = await admin.auth.signInWithPassword({
      email: authEmail,
      password: sessionPassword,
    });
    if (sessionErr || !signed.session) {
      return errorJson("Gagal membuat sesi. Coba masuk manual.", 500, "SESSION");
    }

    return json(
      {
        session: {
          access_token: signed.session.access_token,
          refresh_token: signed.session.refresh_token,
          expires_at: signed.session.expires_at,
        },
        profile: { id: userId, display_name: displayName, public_code: publicCode },
        recovery_key: recoveryKey,
      },
      201,
    );
  } catch (e) {
    return errorJson(`Kesalahan server: ${(e as Error).message}`, 500, "SERVER");
  }
});
