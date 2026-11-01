import Link from "next/link";

export default function NotFound() {
  return (
    <main className="auth-page state-page">
      <header className="auth-header">
        <Link className="auth-brand" href="/" aria-label="PANDA home">
          <strong>panda<span>.</span></strong>
        </Link>
      </header>
      <section className="auth-card state-card">
        <div className="auth-eyebrow">404 · PAGE NOT FOUND</div>
        <h1>This page wandered off.</h1>
        <p className="auth-intro">The page may have moved, or the address may be incorrect.</p>
        <Link className="primary-button state-action" href="/">Back to PANDA</Link>
      </section>
    </main>
  );
}
