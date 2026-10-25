export type MailMessage = Readonly<{
  to: string;
  subject: string;
  text: string;
  html: string;
}>;

export type MailTransport = (message: MailMessage) => Promise<void>;

type MailEnvironment = Readonly<Record<string, string | undefined>>;

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEVELOPMENT_APP_URL = "http://localhost:3000";

let transportOverride: MailTransport | null = null;

/** Test hook: replaces the configured transport until called with null. */
export function setMailTransport(transport: MailTransport | null): void {
  transportOverride = transport;
}

function resendTransport(apiKey: string, from: string): MailTransport {
  return async (message) => {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    // The response body can echo the recipient, so only the status is reported.
    if (!response.ok) throw new Error(`Mail provider rejected the message with status ${response.status}`);
  };
}

// Development has no provider: the message is printed so links can be followed
// locally. It never runs in production, where messages carry live reset tokens.
const consoleTransport: MailTransport = async (message) => {
  console.info(`[mail] to=${message.to} subject=${message.subject}\n${message.text}`);
};

const discardTransport: MailTransport = async () => {};

export function resolveMailTransport(env: MailEnvironment = process.env): MailTransport {
  if (transportOverride) return transportOverride;

  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.MAIL_FROM?.trim();
  if (apiKey && from) return resendTransport(apiKey, from);

  if (env.NODE_ENV === "production") {
    throw new Error("Mail transport is not configured: set RESEND_API_KEY and MAIL_FROM");
  }
  return env.NODE_ENV === "test" ? discardTransport : consoleTransport;
}

export async function sendMail(message: MailMessage): Promise<void> {
  await resolveMailTransport()(message);
}

/**
 * Links in emails are built from configuration, never from the request's Host
 * or Origin headers: a forged header would otherwise put an attacker's domain in
 * front of a real reset token.
 */
export function getAppUrl(env: MailEnvironment = process.env): string {
  const configured = env.APP_URL?.trim();
  if (!configured) {
    if (env.NODE_ENV === "production") throw new Error("APP_URL must be set in production to build email links");
    return DEVELOPMENT_APP_URL;
  }

  const url = new URL(configured);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("APP_URL must be an http(s) URL");
  if (env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("APP_URL must use https in production");
  return url.origin;
}
