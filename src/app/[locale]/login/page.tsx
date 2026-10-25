"use client";

import { useRef, useState } from "react";
import { Link, useRouter } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import Button from "@/components/Button/Button";
import Field from "@/components/Field/Field";
import styles from "./page.module.css";

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations("Auth");
  const [usernameOrEmail, setUsernameOrEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ usernameOrEmail?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const identifierRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: typeof fieldErrors = {};
    if (!usernameOrEmail.trim()) nextErrors.usernameOrEmail = t("usernameOrEmailRequired");
    if (!password) nextErrors.password = t("passwordRequired");

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setError(null);
      requestAnimationFrame(() => (nextErrors.usernameOrEmail ? identifierRef.current : passwordRef.current)?.focus());
      return;
    }

    setLoading(true);
    setError(null);
    setFieldErrors({});

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usernameOrEmail, password }),
      });

      if (!res.ok) {
        setError(t("loginFailed"));
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setError(t("loginFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={styles.main}>
      <div className={`${styles.authCard} glass`}>
        <h2 className={styles.title}>{t("loginTitle")}</h2>
        <p className={styles.subtitle}>{t("loginSubtitle")}</p>

        <form onSubmit={handleSubmit} className={styles.form} noValidate>
          <Field
            id="login-identifier"
            label={t("usernameOrEmail")}
            error={fieldErrors.usernameOrEmail}
            required
          >
            <input
              ref={identifierRef}
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={usernameOrEmail}
              onChange={(e) => {
                setUsernameOrEmail(e.target.value);
                if (fieldErrors.usernameOrEmail) setFieldErrors((current) => ({ ...current, usernameOrEmail: undefined }));
              }}
              placeholder={t("emailPlaceholder")}
              className="input-field"
              disabled={loading}
            />
          </Field>

          <Field
            id="login-password"
            label={t("password")}
            error={fieldErrors.password}
            required
          >
            <input
              ref={passwordRef}
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (fieldErrors.password) setFieldErrors((current) => ({ ...current, password: undefined }));
              }}
              placeholder="••••••••"
              className="input-field"
              disabled={loading}
            />
          </Field>

          <Link href="/forgot-password" className={styles.forgotLink}>
            {t("forgotPassword")}
          </Link>

          {error &&<div className={styles.errorMsg} role="alert">{error}</div>}

          <Button type="submit" variant="neon" isLoading={loading} loadingLabel={t("loggingIn")}>
            {t("login")}
          </Button>
        </form>

        <p className={styles.footerText}>
          {t("noAccount")} <Link href="/register">{t("createFree")}</Link>
        </p>
      </div>
    </main>
  );
}
