"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "@/app/landing/components/auth-shell";
import { useAuth } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api-client";

export default function SignInPage() {
  const router = useRouter();
  const { signin } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await signin(email, password);
      router.push("/dashboard/inbox");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back."
      subtitle="Pick up where your team left off — inbox, macros, and AI copilot."
      footer={
        <div className="flex items-center justify-between">
          <span>© {new Date().getFullYear()} Connect Labs</span>
          <div className="flex gap-4">
            <Link href="/privacy">Privacy</Link>
            <a href="#">Terms</a>
          </div>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-600">
            {error}
          </div>
        )}

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Work email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-ink"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-ink"
          />
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-ink py-3 text-sm font-medium text-primary-foreground transition hover:bg-ink/90 disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Sign in <ArrowRight className="h-4 w-4" />
        </button>

        <div className="pt-2 text-center text-sm text-muted-foreground">
          New to Connect?{" "}
          <Link href="/signup" className="text-ink underline underline-offset-4">
            Create an account
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}
