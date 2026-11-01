"use client";

import Link from "next/link";

export default function ErrorPage({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="auth-page state-page">
      <section className="auth-card state-card" role="alert">
        <div className="auth-eyebrow">SOMETHING WENT WRONG</div>
        <h1>This page didn’t load.</h1>
        <p className="auth-intro">Please try again. If the problem continues, return home and try again later.</p>
        <button className="primary-button state-action" onClick={retry}>Try again</button>
        <Link className="auth-back state-home-link" href="/">Back to PANDA</Link>
      </section>
    </main>
  );
}
