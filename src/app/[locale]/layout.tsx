import type { Metadata } from "next";
import { JetBrains_Mono, Rajdhani } from "next/font/google";
import Navbar from "@/components/Navbar/Navbar";
import Footer from "@/components/Footer/Footer";
import BottomNav from "@/components/BottomNav/BottomNav";
import ToastListener from "@/components/Toast/ToastListener";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { getAuthUser } from "@/utils/auth";
import "../globals.css";

const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
const rajdhani = Rajdhani({ weight: ["400", "500", "600", "700"], subsets: ["latin"], variable: "--font-display" });
const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
const openGraphLocales: Record<string, string> = { es: "es_ES", en: "en_US", pt: "pt_BR" };

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "Metadata" });
  const title = t("siteTitle");
  const description = t("siteDescription");
  return {
    metadataBase: new URL(siteUrl), title, description,
    openGraph: { title, description, url: siteUrl, siteName: "Ride The Music", images: [{ url: "/logo.png", width: 1200, height: 630, alt: "Ride The Music" }], locale: openGraphLocales[locale] ?? openGraphLocales.en, type: "website" },
    twitter: { card: "summary_large_image", title, description, images: ["/logo.png"] }
  };
}

export default async function RootLayout({ children, params: { locale } }: Readonly<{ children: React.ReactNode; params: { locale: string } }>) {
  const messages = await getMessages();
  const authUser = await getAuthUser();
  const sessionUser = authUser ? { id: authUser.userId, username: authUser.username } : null;

  return <html lang={locale}><body className={`${jetbrainsMono.variable} ${rajdhani.variable}`}><NextIntlClientProvider messages={messages}><Navbar initialUser={sessionUser} /><div className="page-content">{children}</div><Footer /><BottomNav initialUser={sessionUser} /><ToastListener /></NextIntlClientProvider></body></html>;
}
