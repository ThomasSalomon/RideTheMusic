"use client";

import { useRef, useState } from "react";
import { Link } from "@/i18n/routing";
import { useLocale, useTranslations } from "next-intl";
import Button from "@/components/Button/Button";
import Field from "@/components/Field/Field";
import styles from "../login/page.module.css";

// Mirrors PASSWORD_RESET_TTL_MINUTES on the server.
const RESET_LINK_MINUTES = 30;

export default function ForgotPasswordPage() {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextError = !email.trim()
      ? t("emailRequired")
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
        ? t("emailInvalid")
        : undefined;

    if (nextError) {
      setFieldError(nextError);
      setError(null);
      requestAnimationFrame(() => emailRef.current?.focus());
      return;
    }

    setLoading(true);
    setError(null);
    setFieldError(undefined);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), locale }),
      });

      if (res.status === 429) {
        setError(t("tooManyAttempts"));
        return;
      }
      if (!res.ok) {
        setError(t("requestFailed"));
        return;
      }

      setSent(true);
    } catch {
      setError(t("requestFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={styles.main}>
      <div className={`${styles.authCard} glass`}>
        <h2 className={styles.title}>{t("forgotTitle")}</h2>
        <p className={styles.subtitle}>{t("forgotSubtitle")}</p>

        {sent ? (
          <div className={styles.successMsg} role="status">
            {t("resetLinkSent", { minutes: RESET_LINK_MINUTES })}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className={styles.form} noValidate>
            <Field id="forgot-email" label={t("email")} error={fieldError} required>
              <input
                ref={emailRef}
                name="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (fieldError) setFieldError(undefined);
                }}
                placeholder={t("emailPlaceholder")}
                className="input-field"
                disabled={loading}
              />
            </Field>

            {error && <div className={styles.errorMsg} role="alert">{error}</div>}

            <Button type="submit" variant="neon" isLoading={loading} loadingLabel={t("sendingResetLink")}>
              {t("sendResetLink")}
            </Button>
          </form>
        )}

        <p className={styles.footerText}>
          <Link href="/login">{t("backToLogin")}</Link>
        </p>
      </div>
    </main>
  );
}
