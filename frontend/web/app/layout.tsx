import { Instrument_Serif, Inter_Tight, JetBrains_Mono } from "next/font/google";
import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

const display = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-display",
});

const sans = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-sans",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

const siteUrl = "https://onconnect.one";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Connect — AI-powered support that speaks every customer's language",
  description:
    "Connect is the AI customer support platform for global teams. Resolve conversations in 90+ languages, deflect tickets before they open, and keep every reply on-brand.",
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: "/Connect_White.svg",
    apple: "/Connect_White.svg",
  },
  openGraph: {
    title: "Connect — AI customer support for global teams",
    description:
      "Resolve conversations in 90+ languages with an AI agent tuned to your brand. The modern alternative to Intercom and Crisp.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <head>
        <script
          defer
          src="https://usrly-five.vercel.app/userly.js"
          data-domain="onconnect.one"
        />
      </head>
      <body
        suppressHydrationWarning={true}
        className="min-h-screen bg-background font-sans text-foreground antialiased"
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
