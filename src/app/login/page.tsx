"use client";

import { ArrowLeft, Check, Eye, EyeOff, LockKeyhole, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { signInSchema, signUpSchema, usernameSchema } from "@/lib/validation/auth";

async function postAuthRequest(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as { error?: string; success?: boolean };

  if (!response.ok) {
    throw new Error(result.error ?? "We couldn't complete that request. Please try again.");
  }

  return result;
}

function LoginContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const configured = isSupabaseConfigured();
  const [usernameAvailability, setUsernameAvailability] = useState<"idle" | "checking" | "available" | "taken" | "error">("idle");

  useEffect(() => {
    const parsedUsername = usernameSchema.safeParse(username);
    if (mode !== "signup" || !configured || !parsedUsername.success) {
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { data, error: checkError } = await createSupabaseBrowserClient()
            .rpc("is_username_available", { p_username: parsedUsername.data });
          if (!active) return;
          if (checkError) {
            console.error("Username availability check failed:", checkError.message);
            setUsernameAvailability("error");
            return;
          }
          setUsernameAvailability(data ? "available" : "taken");
        } catch (checkError) {
          if (!active) return;
          console.error("Username availability check failed:", checkError instanceof Error ? checkError.message : "Unknown error");
          setUsernameAvailability("error");
        }
      })();
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [configured, mode, username]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    const result = mode === "signup"
      ? signUpSchema.safeParse({ username, password, confirmPassword, displayName, isPrivate })
      : signInSchema.safeParse({ username, password });

    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Check the information and try again.");
      return;
    }
    if (!configured) {
      setError("Supabase is not connected yet. Follow the setup steps in README.md.");
      return;
    }

    setBusy(true);
    try {
      const response = await postAuthRequest(
        mode === "signup" ? "/api/auth/register" : "/api/auth/login",
        result.data,
      );
      if (mode === "signup" && response.success) {
        router.push("/");
        router.refresh();
      } else if (mode === "login" && response.success) {
        router.push("/");
        router.refresh();
      } else {
        setMessage("Your account was created. Sign in with your username and password to continue.");
        setMode("login");
        setPassword("");
        setConfirmPassword("");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't complete that request. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const callbackError = searchParams.get("error");

  return (
    <main className="auth-page">
      <header className="auth-header"><Link href="/" className="auth-brand"><span className="panda-icon" aria-hidden="true"><i /><i /><b /></span><strong>panda<span>.</span></strong></Link><Link href="/" className="auth-back"><ArrowLeft size={15} />Back to PANDA</Link></header>
      <section className="auth-card">
        <div className="auth-emblem"><span className="panda-icon" aria-hidden="true"><i /><i /><b /></span></div>
        <div className="auth-eyebrow">A LITTLE MORE CONNECTED</div>
        <h1>{mode === "login" ? "Good to have you back." : "Find your people."}</h1>
        <p className="auth-intro">{mode === "login" ? "Sign in to pick up right where your people are." : "Create your account and make yourself at home."}</p>
        <div className="auth-tabs" role="tablist" aria-label="Authentication">
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "selected" : ""} onClick={() => { setMode("login"); setUsernameAvailability("idle"); setError(""); setMessage(""); }}>Sign in</button>
          <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "selected" : ""} onClick={() => { setMode("signup"); setUsernameAvailability(configured && usernameSchema.safeParse(username).success ? "checking" : "idle"); setError(""); setMessage(""); }}>Create account</button>
        </div>
        {!configured && <div className="auth-config-note"><LockKeyhole size={15} /><span>Account services are unavailable until Supabase is configured.</span></div>}
        {callbackError && <div className="auth-error" role="alert">{callbackError === "configuration" ? "Supabase is not configured." : "We couldn't confirm that sign-in link. Please try again."}</div>}
        {error && <div className="auth-error" role="alert">{error}</div>}
        {message && <div className="auth-success" role="status"><Check size={16} />{message}</div>}
        <form onSubmit={submit} className="auth-form">
          {mode === "signup" && <label>Display name<input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="How people know you" maxLength={60} required /><UserRound size={16} /></label>}
          {mode === "signup" && <fieldset className="account-privacy-choice">
            <legend>Account privacy</legend>
            <label><input type="radio" name="account-privacy" checked={!isPrivate} onChange={() => setIsPrivate(false)} /><span><strong>Public account</strong><small>Anyone can see your profile and posts.</small></span></label>
            <label><input type="radio" name="account-privacy" checked={isPrivate} onChange={() => setIsPrivate(true)} /><span><strong>Private account</strong><small>Only approved followers can see your posts.</small></span></label>
          </fieldset>}
          <label>Username<input autoComplete="username" value={username} onChange={(event) => { setUsername(event.target.value); setUsernameAvailability(mode === "signup" && configured && usernameSchema.safeParse(event.target.value).success ? "checking" : "idle"); }} placeholder="yourname" maxLength={24} autoCapitalize="none" spellCheck={false} required /><span className="input-prefix">@</span></label>
          {mode === "signup" && usernameAvailability !== "idle" && <p className={`auth-username-availability ${usernameAvailability}`} role={usernameAvailability === "taken" ? "alert" : "status"}>
            {usernameAvailability === "checking" && "Checking username…"}
            {usernameAvailability === "available" && "Username available"}
            {usernameAvailability === "taken" && "Username already taken"}
            {usernameAvailability === "error" && "Couldn't check availability. It will be confirmed when you create your account."}
          </p>}
          <label>Password<input type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" minLength={8} maxLength={72} required /><button className="password-toggle" type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></label>
          {mode === "signup" && <label>Confirm password<input type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Enter your password again" minLength={8} maxLength={72} required /><button className="password-toggle" type="button" onClick={() => setShowConfirmPassword((current) => !current)} aria-label={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"}>{showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></label>}
          {mode === "login" && <Link href="/reset-password" className="forgot-password">Forgot your password?</Link>}
          <button type="submit" className="auth-submit" disabled={busy || !configured}>{busy ? "One moment..." : mode === "login" ? "Sign in" : "Create your account"}</button>
        </form>
        <div className="auth-divider"><span />JUST THE BASICS<span /></div>
        <div className="auth-security"><LockKeyhole size={14} /><span>Your password is handled by Supabase Auth and is never stored by PANDA.</span></div>
        <p className="auth-username-note">Your username maps to a private Supabase Auth identity. Only your username is used to sign in.</p>
      </section>
      <footer className="auth-footer">A little more human. <span>·</span> Your space, your pace.</footer>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense><LoginContent /></Suspense>;
}
