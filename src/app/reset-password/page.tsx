"use client";

import { z } from "zod";
import { ArrowLeft, Check, LockKeyhole, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { resetRequestSchema } from "@/lib/validation/auth";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

const passwordSchema = z.string().min(8, "Use at least 8 characters.").max(72, "Use no more than 72 characters.");

export default function ResetPasswordPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);

  async function requestReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    const result = resetRequestSchema.safeParse({ username });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Enter a valid username.");
      return;
    }
    if (!isSupabaseConfigured()) {
      setError("Supabase is not configured.");
      return;
    }

    setRequestBusy(true);
    try {
      const response = await fetch("/api/auth/reset-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.data),
      });
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error ?? "Password recovery is temporarily unavailable.");
      setMessage(data.message ?? "If this account can recover its password, a reset link will be sent.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Password recovery is temporarily unavailable.");
    } finally {
      setRequestBusy(false);
    }
  }

  async function updatePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    const result = passwordSchema.safeParse(password);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Choose a valid password.");
      return;
    }
    if (password !== confirmation) {
      setError("Those passwords don’t match.");
      return;
    }
    if (!isSupabaseConfigured()) {
      setError("Supabase is not configured.");
      return;
    }

    setUpdateBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({ password: result.data });
      if (updateError) throw updateError;
      setMessage("Your password has been updated. You can now sign in.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't update your password. Request a fresh reset link and try again.");
    } finally {
      setUpdateBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <header className="auth-header"><Link href="/" className="auth-brand"><span className="panda-icon" aria-hidden="true"><i /><i /><b /></span><strong>panda<span>.</span></strong></Link><Link href="/login" className="auth-back"><ArrowLeft size={15} />Back to sign in</Link></header>
      <section className="auth-card reset-card">
        <div className="auth-emblem"><LockKeyhole size={19} /></div>
        <div className="auth-eyebrow">A FRESH START</div>
        <h1>Need a new password?</h1>
        <p className="auth-intro">Request a recovery link for an existing account, or set a new password from a valid recovery session.</p>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {message && <div className="auth-success" role="status"><Check size={16} />{message}</div>}
        <form className="auth-form" onSubmit={requestReset}>
          <label>Username<input autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="yourname" maxLength={24} required /><UserRound size={16} /></label>
          <button type="submit" className="auth-submit" disabled={requestBusy}>{requestBusy ? "One moment..." : "Request a recovery link"}</button>
        </form>
        <p className="auth-username-note">Accounts created with username-only credentials do not yet have a recovery method. Existing accounts with a verified recovery address can request a link.</p>
        <div className="auth-divider"><span />ALREADY HAVE A RECOVERY LINK?<span /></div>
        <form className="auth-form reset-form" onSubmit={updatePassword}>
          <label>New password<input type="password" autoComplete="new-password" minLength={8} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} maxLength={72} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label>
          <button type="submit" className="auth-submit" disabled={updateBusy}>{updateBusy ? "Updating..." : "Update password"}</button>
        </form>
        <div className="auth-security"><LockKeyhole size={14} /><span>Your password is updated securely by Supabase Auth.</span></div>
      </section>
      <footer className="auth-footer">A little more human. <span>·</span> Your space, your pace.</footer>
    </main>
  );
}
