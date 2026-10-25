import { readCookie } from "@/utils/auth";
import type { MailMessage } from "@/services/mail";

// Mirrors src/i18n/routing.ts, which also loads next-intl's client navigation.
const EMAIL_LOCALES = ["es", "en", "pt"] as const;
const DEFAULT_EMAIL_LOCALE: EmailLocale = "en";

export type EmailLocale = (typeof EMAIL_LOCALES)[number];

const BRAND = "Ride The Music";

type Copy = {
  greeting: (username: string) => string;
  footer: string;
  newSignIn: {
    subject: string;
    intro: string;
    when: string;
    device: string;
    ip: string;
    unknownDevice: string;
    ifYou: string;
    ifNotYou: string;
    action: string;
  };
  passwordReset: {
    subject: string;
    intro: (minutes: number) => string;
    action: string;
    ignore: string;
  };
  passwordChanged: {
    subject: string;
    intro: (date: string) => string;
    ifNotYou: string;
    action: string;
  };
};

const COPY: Record<EmailLocale, Copy> = {
  es: {
    greeting: (username) => `Hola ${username}:`,
    footer: `Este es un correo automático de seguridad de ${BRAND}. Nunca te vamos a pedir tu contraseña por correo.`,
    newSignIn: {
      subject: `Nuevo inicio de sesión en tu cuenta de ${BRAND}`,
      intro: "Alguien entró a tu cuenta desde un navegador o dispositivo que no habíamos visto antes.",
      when: "Fecha",
      device: "Dispositivo",
      ip: "Dirección IP",
      unknownDevice: "Desconocido",
      ifYou: "Si fuiste vos, no tenés que hacer nada.",
      ifNotYou: "Si no fuiste vos, restablecé tu contraseña ahora: eso cierra todas las sesiones abiertas.",
      action: "Restablecer contraseña",
    },
    passwordReset: {
      subject: `Restablecé tu contraseña de ${BRAND}`,
      intro: (minutes) =>
        `Recibimos un pedido para restablecer la contraseña de tu cuenta. El enlace vence en ${minutes} minutos y sirve una sola vez.`,
      action: "Elegir una contraseña nueva",
      ignore: "Si no lo pediste, ignorá este correo: tu contraseña no cambia.",
    },
    passwordChanged: {
      subject: `Tu contraseña de ${BRAND} cambió`,
      intro: (date) => `La contraseña de tu cuenta se cambió el ${date}. Cerramos todas las sesiones abiertas.`,
      ifNotYou: "Si no fuiste vos, pedí un enlace de recuperación ahora mismo y revisá la seguridad de tu correo.",
      action: "Recuperar mi cuenta",
    },
  },
  en: {
    greeting: (username) => `Hi ${username},`,
    footer: `This is an automated security email from ${BRAND}. We will never ask for your password by email.`,
    newSignIn: {
      subject: `New sign-in to your ${BRAND} account`,
      intro: "Someone signed in to your account from a browser or device we hadn't seen before.",
      when: "Date",
      device: "Device",
      ip: "IP address",
      unknownDevice: "Unknown",
      ifYou: "If this was you, there's nothing you need to do.",
      ifNotYou: "If this wasn't you, reset your password now: that signs out every open session.",
      action: "Reset password",
    },
    passwordReset: {
      subject: `Reset your ${BRAND} password`,
      intro: (minutes) =>
        `We received a request to reset your account password. The link expires in ${minutes} minutes and works only once.`,
      action: "Choose a new password",
      ignore: "If you didn't ask for this, ignore this email: your password stays the same.",
    },
    passwordChanged: {
      subject: `Your ${BRAND} password was changed`,
      intro: (date) => `Your account password was changed on ${date}. We signed out every open session.`,
      ifNotYou: "If this wasn't you, request a recovery link right away and check the security of your email account.",
      action: "Recover my account",
    },
  },
  pt: {
    greeting: (username) => `Olá ${username},`,
    footer: `Este é um e-mail automático de segurança do ${BRAND}. Nunca vamos pedir sua senha por e-mail.`,
    newSignIn: {
      subject: `Novo acesso à sua conta do ${BRAND}`,
      intro: "Alguém entrou na sua conta a partir de um navegador ou dispositivo que ainda não conhecíamos.",
      when: "Data",
      device: "Dispositivo",
      ip: "Endereço IP",
      unknownDevice: "Desconhecido",
      ifYou: "Se foi você, não precisa fazer nada.",
      ifNotYou: "Se não foi você, redefina sua senha agora: isso encerra todas as sessões abertas.",
      action: "Redefinir senha",
    },
    passwordReset: {
      subject: `Redefina sua senha do ${BRAND}`,
      intro: (minutes) =>
        `Recebemos um pedido para redefinir a senha da sua conta. O link expira em ${minutes} minutos e só pode ser usado uma vez.`,
      action: "Escolher uma nova senha",
      ignore: "Se você não pediu isso, ignore este e-mail: sua senha continua a mesma.",
    },
    passwordChanged: {
      subject: `Sua senha do ${BRAND} foi alterada`,
      intro: (date) => `A senha da sua conta foi alterada em ${date}. Encerramos todas as sessões abertas.`,
      ifNotYou: "Se não foi você, peça um link de recuperação agora mesmo e verifique a segurança do seu e-mail.",
      action: "Recuperar minha conta",
    },
  },
};

export function isEmailLocale(value: unknown): value is EmailLocale {
  return typeof value === "string" && (EMAIL_LOCALES as readonly string[]).includes(value);
}

/** The locale the visitor browses with: next-intl's cookie, then Accept-Language. */
export function resolveEmailLocale(request: Request): EmailLocale {
  const cookieLocale = readCookie(request, "NEXT_LOCALE");
  if (isEmailLocale(cookieLocale)) return cookieLocale;

  for (const entry of (request.headers.get("accept-language") ?? "").split(",")) {
    const language = entry.split(";")[0].trim().slice(0, 2).toLowerCase();
    if (isEmailLocale(language)) return language;
  }
  return DEFAULT_EMAIL_LOCALE;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Accounts have no time zone, so dates are shown in UTC and labelled as such.
function formatDate(date: Date, locale: EmailLocale): string {
  const formatted = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
  return `${formatted} UTC`;
}

type Layout = {
  locale: EmailLocale;
  username: string;
  paragraphs: string[];
  details?: Array<[label: string, value: string]>;
  action: { label: string; url: string };
  afterAction?: string;
};

function render(to: string, subject: string, layout: Layout): MailMessage {
  const copy = COPY[layout.locale];
  const details = layout.details ?? [];

  const text = [
    copy.greeting(layout.username),
    "",
    ...layout.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    ...details.map(([label, value]) => `${label}: ${value}`),
    ...(details.length > 0 ? [""] : []),
    `${layout.action.label}: ${layout.action.url}`,
    ...(layout.afterAction ? ["", layout.afterAction] : []),
    "",
    "—",
    copy.footer,
  ].join("\n");

  const paragraph = (value: string) =>
    `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(value)}</p>`;
  const detailRows = details
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#6b7280">${escapeHtml(label)}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="${layout.locale}">
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#111827">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
<p style="margin:0 0 24px;font-weight:bold;font-size:18px">${BRAND}</p>
${paragraph(copy.greeting(layout.username))}
${layout.paragraphs.map(paragraph).join("\n")}
${detailRows ? `<table style="margin:0 0 16px;border-collapse:collapse;font-size:14px">${detailRows}</table>` : ""}
<p style="margin:24px 0"><a href="${escapeHtml(layout.action.url)}" style="display:inline-block;padding:12px 20px;background:#10b981;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold">${escapeHtml(layout.action.label)}</a></p>
${layout.afterAction ? paragraph(layout.afterAction) : ""}
<p style="margin:24px 0 0;font-size:12px;color:#6b7280;line-height:1.5">${escapeHtml(copy.footer)}</p>
</div>
</body>
</html>`;

  return { to, subject, text, html };
}

export function newSignInEmail(input: {
  locale: EmailLocale;
  to: string;
  username: string;
  signedInAt: Date;
  device: string | null;
  ip: string | null;
  recoveryUrl: string;
}): MailMessage {
  const copy = COPY[input.locale].newSignIn;
  const details: Array<[string, string]> = [
    [copy.when, formatDate(input.signedInAt, input.locale)],
    [copy.device, input.device ?? copy.unknownDevice],
  ];
  if (input.ip) details.push([copy.ip, input.ip]);

  return render(input.to, copy.subject, {
    locale: input.locale,
    username: input.username,
    paragraphs: [copy.intro],
    details,
    action: { label: copy.action, url: input.recoveryUrl },
    afterAction: `${copy.ifYou} ${copy.ifNotYou}`,
  });
}

export function passwordResetEmail(input: {
  locale: EmailLocale;
  to: string;
  username: string;
  resetUrl: string;
  expiresInMinutes: number;
}): MailMessage {
  const copy = COPY[input.locale].passwordReset;
  return render(input.to, copy.subject, {
    locale: input.locale,
    username: input.username,
    paragraphs: [copy.intro(input.expiresInMinutes)],
    action: { label: copy.action, url: input.resetUrl },
    afterAction: copy.ignore,
  });
}

export function passwordChangedEmail(input: {
  locale: EmailLocale;
  to: string;
  username: string;
  changedAt: Date;
  recoveryUrl: string;
}): MailMessage {
  const copy = COPY[input.locale].passwordChanged;
  return render(input.to, copy.subject, {
    locale: input.locale,
    username: input.username,
    paragraphs: [copy.intro(formatDate(input.changedAt, input.locale)), copy.ifNotYou],
    action: { label: copy.action, url: input.recoveryUrl },
  });
}
