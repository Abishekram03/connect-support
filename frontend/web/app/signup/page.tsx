"use client";

import { ArrowRight, Check, Loader2, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { AuthShell } from "@/app/landing/components/auth-shell";
import { useAuth } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api-client";

type Step = "credentials" | "code" | "workspace";

export default function SignUpPage() {
  const { sendCode, verifyCode, completeSignup } = useAuth();
  const [step, setStep] = useState<Step>("credentials");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [tempToken, setTempToken] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const perks = [
    "14-day trial, no card required",
    "AI copilot in 90+ languages",
    "Unlimited seats during trial",
  ];

  useEffect(() => {
    if (cooldown > 0) {
      const t = setInterval(() => setCooldown((c) => c - 1), 1000);
      return () => clearInterval(t);
    }
  }, [cooldown]);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await sendCode(email);
      setStep("code");
      setCooldown(30);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } catch (err: any) {
      setError(err.message || "Failed to send verification code");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCodeChange = (index: number, value: string) => {
    if (value.length > 1) {
      const digits = value.replace(/\D/g, "").slice(0, 6);
      const newCode = [...code];
      for (let i = 0; i < 6; i++) newCode[i] = digits[i] || "";
      setCode(newCode);
      const next = Math.min(digits.length, 5);
      inputRefs.current[next]?.focus();
      if (digits.length === 6) handleVerify(digits);
      return;
    }
    if (value && !/^\d$/.test(value)) return;
    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
    const full = newCode.join("");
    if (full.length === 6) handleVerify(full);
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async (fullCode?: string) => {
    const codeToVerify = fullCode || code.join("");
    if (codeToVerify.length !== 6) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await verifyCode(email, codeToVerify);
      if (res.action === "signup" && res.temp_token) {
        setTempToken(res.temp_token);
        setStep("workspace");
      } else if (res.action === "signin") {
        setError("This email already has an account. Please sign in instead.");
        setStep("credentials");
      }
    } catch (err: any) {
      setError(err.message || "Invalid code");
      setCode(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setError("");
    setSubmitting(true);
    try {
      await sendCode(email);
      setCooldown(30);
    } catch (err: any) {
      setError(err.message || "Failed to resend code");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      await completeSignup(tempToken, name, password, orgName, slug);
    } catch (err: any) {
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
      title={
        step === "credentials" ? "Start supporting the world." :
        step === "code" ? "Check your email" :
        "Name your workspace"
      }
      subtitle={
        step === "credentials"
          ? "Spin up a workspace, connect a channel, and let the AI copilot handle the rest."
          : step === "code"
          ? `We sent a 6-digit code to ${email}`
          : "Almost there — just one last step."
      }
      footer={
        <div>
          By continuing you agree to Connect&apos;s <a href="#">Terms</a> and{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </div>
      }
    >
      {step === "credentials" && (
        <>
          <ul className="mb-8 space-y-2">
            {perks.map((p) => (
              <li key={p} className="flex items-center gap-2 text-sm text-muted-foreground">
                <Check className="h-4 w-4 text-accent-foreground" strokeWidth={3} />
                {p}
              </li>
            ))}
          </ul>

          <form onSubmit={handleSignUp} className="space-y-4">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-600">
                {error}
              </div>
            )}
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Your name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ava Martinez"
                required
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-ink"
              />
            </label>
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
                placeholder="At least 8 characters"
                required
                minLength={8}
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-ink"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Confirm password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat your password"
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
              Sign up <ArrowRight className="h-4 w-4" />
            </button>

            <div className="pt-2 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/signin" className="text-ink underline underline-offset-4">
                Sign in
              </Link>
            </div>
          </form>
        </>
      )}

      {step === "code" && (
        <div className="space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-600">
              {error}
            </div>
          )}
          <div className="flex gap-2 justify-center">
            {code.map((digit, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={digit}
                onChange={(e) => handleCodeChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                className="h-12 w-11 rounded-xl border border-border bg-background text-center text-lg font-semibold text-ink outline-none transition focus:border-ink"
              />
            ))}
          </div>
          <button
            onClick={() => handleVerify()}
            disabled={submitting || code.join("").length !== 6}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-ink py-3 text-sm font-medium text-primary-foreground transition hover:bg-ink/90 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Verify email
          </button>
          <div className="flex items-center justify-between text-sm">
            <button
              onClick={() => { setStep("credentials"); setError(""); setCode(["", "", "", "", "", ""]); }}
              className="flex items-center gap-1 text-muted-foreground hover:text-ink"
            >
              <ChevronLeft className="h-3 w-3" />
              Change email
            </button>
            <button
              onClick={handleResend}
              disabled={cooldown > 0 || submitting}
              className="text-muted-foreground hover:text-ink disabled:opacity-50"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </button>
          </div>
        </div>
      )}

      {step === "workspace" && (
        <form onSubmit={handleCreateWorkspace} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-600">
              {error}
            </div>
          )}
          <div className="rounded-lg border border-border bg-surface px-4 py-2 text-xs text-muted-foreground">
            {email}
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">Company name</span>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Acme Inc."
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
            Create workspace <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      )}
    </AuthShell>
  );
}
