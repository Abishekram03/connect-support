import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | Edge",
  description: "Privacy policy for Edge, the AI customer support platform.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-10 md:px-10 md:py-16">
        <Link
          href="/landing"
          className="text-sm text-muted-foreground hover:text-ink"
        >
          Back to Edge
        </Link>

        <header className="mt-16 max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Legal
          </p>
          <h1 className="mt-4 font-display text-5xl leading-tight text-ink md:text-7xl">
            Privacy Policy
          </h1>
          <p className="mt-5 text-sm leading-7 text-muted-foreground">
            This page is provided for privacy preferences and policy
            information. Last updated October 3, 2026.
          </p>
        </header>

        <div
          id="usrly-privacy-policy"
          data-domain="onconnect.one"
          className="mt-12 min-h-24 rounded-xl border border-border bg-surface p-6"
        />
        <script defer src="https://usrly-five.vercel.app/script.js" />

        <article className="mt-16 max-w-2xl space-y-10 text-sm leading-7 text-muted-foreground">
          <section>
            <h2 className="text-lg font-semibold text-ink">
              Information we collect
            </h2>
            <p className="mt-3">
              We collect information you provide when you create an account, use
              Edge, contact support, or configure integrations. This may include
              your name, work email, workspace details, messages, and technical
              usage information.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">
              How we use information
            </h2>
            <p className="mt-3">
              We use information to provide and secure the service, operate your
              workspace, improve product performance, communicate with you, and
              meet legal obligations. We do not sell personal information.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Your choices</h2>
            <p className="mt-3">
              You can request access to, correction of, or deletion of your
              personal information by contacting your workspace administrator or
              our support team. Browser settings can also be used to manage
              cookies and similar technologies.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Contact</h2>
            <p className="mt-3">
              For privacy questions, contact us through the Edge support team.
            </p>
          </section>
        </article>
      </div>
    </main>
  );
}
