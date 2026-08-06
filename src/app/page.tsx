import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-16">
        <header className="flex items-center justify-between">
          <span className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">
            Watch Anything
          </span>
          <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400">
            MVP scaffold
          </span>
        </header>

        <section className="max-w-3xl space-y-8">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-400">
            A calmer way to keep watch
          </p>
          <h1 className="text-5xl font-semibold tracking-tight text-white sm:text-7xl">
            Turn a question into a radar.
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-slate-300">
            Describe what matters to you. Watch Anything will turn it into focused
            rules and bring back the updates worth your attention.
          </p>
          <Link
            href="/rules"
            className="inline-flex rounded-full bg-cyan-300 px-6 py-3 font-semibold text-slate-950 transition hover:bg-cyan-200"
          >
            Start with a request
          </Link>
        </section>
      </div>
    </main>
  );
}
