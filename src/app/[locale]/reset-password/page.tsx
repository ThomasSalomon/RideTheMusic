"use client";

import { useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/routing";
import { useLocale, useTranslations } from "next-intl";
import Button from "@/components/Button/Button";
import Field from "@/components/Field/Field";
import styles from "../login/page.module.css";

type ResetField = "newPassword" | "confirmPassword";
type Status = "loading" | "ready" | "invalid" | "done";

export default function ResetPasswordPage() {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ResetField, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  // The emailed link carries the token in the fragment so it never reaches
  // server logs. It is read once and dropped from the address bar and history.
  useEffect(() => {
    const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (fromHash) {
      window.history.replaceState(null, "", window.location.pathname);
      setToken(fromHash);
      setStatus("ready");
    } else {
      setStatus("invalid");
    }
  }, []);

  const clearFieldError = (field: ResetField) => {
    if (fieldErrors[field]) setFieldErrors((current) => ({ ...current, [field]: undefined }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    const nextErrors: Partial<Record<ResetField, string>> = {};
    if (!newPassword) nextErrors.newPassword = t("passwordRequired");
    else if (newPassword.length < 6) nextErrors.newPassword = t("passwordMin");
    if (!confirmPassword) nextErrors.confirmPassword = t("confirmPasswordRequired");
    else if (newPassword && confirmPassword !== newPassword) nextErrors.confirmPassword = t("passwordsDontMatch");

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setError(null);
      requestAnimationFrame(() =>
        (nextErrors.newPassword ? newPasswordRef.current : confirmPasswordRef.current)?.focus(),
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword, locale }),
      });

      if (res.ok) {
        setToken(null);
        setStatus("done");
        return;
      }
      if (res.status === 429) {
        setError(t("tooManyAttempts"));
        return;
      }

      const data = await res.json().catch(() => null);
      if (data?.code === "RESET_TOKEN_INVALID") {
        setToken(null);
        setStatus("invalid");
        return;
      }
      setError(t("resetFailed"));
    } catch {
      setError(t("resetFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className={styles.main}>
      <div className={`${styles.authCard} glass`}>
        <h2 className={styles.title}>{t("resetTitle")}</h2>

        {status === "ready" && (
          <>
            <p className={styles.subtitle}>{t("resetSubtitle")}</p>
            <form onSubmit={handleSubmit} className={styles.form} noValidate>
              <Field id="reset-new-password" label={t("newPassword")} error={fieldErrors.newPassword} required>
                <input
                  ref={newPasswordRef}
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    clearFieldError("newPassword");
                  }}
                  placeholder={t("passwordPlaceholder")}
                  className="input-field"
                  disabled={submitting}
                />
              </Field>

              <Field
                id="reset-confirm-password"
                label={t("confirmPassword")}
                error={fieldErrors.confirmPassword}
                required
              >
                <input
                  ref={confirmPasswordRef}
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    clearFieldError("confirmPassword");
                  }}
                  placeholder="••••••••"
                  className="input-field"
                  disabled={submitting}
                />
              </Field>

              {error && <div className={styles.errorMsg} role="alert">{error}</div>}

              <Button type="submit" variant="neon" isLoading={submitting} loadingLabel={t("savingPassword")}>
                {t("savePassword")}
              </Button>
            </form>
          </>
        )}

        {status === "invalid" && (
          <>
            <div className={styles.errorMsg} role="alert">{t("resetLinkInvalid")}</div>
            <p className={styles.footerText}>
              <Link href="/forgot-password">{t("requestNewLink")}</Link>
            </p>
          </>
        )}

        {status === "done" && (
          <div className={styles.successMsg} role="status">{t("resetSuccess")}</div>
        )}

        {status !== "invalid" && (
          <p className={styles.footerText}>
            <Link href="/login">{t("backToLogin")}</Link>
          </p>
        )}
      </div>
    </main>
  );
}
