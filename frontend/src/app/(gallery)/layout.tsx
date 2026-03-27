import Link from "next/link";

export default function GalleryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 font-sans">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <Link
            href="/"
            className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            PhotoMind
          </Link>
          <nav className="flex items-center gap-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
            <Link
              href="/"
              className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              Gallery
            </Link>
            <Link
              href="/search"
              className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              Search
            </Link>
            <Link
              href="/faces"
              className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              Faces
            </Link>
            <Link
              href="/dashboard"
              className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              Dashboard
            </Link>
            <Link
              href="/logs"
              className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              Logs
            </Link>
            <Link
              href="/settings"
              className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              Settings
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
