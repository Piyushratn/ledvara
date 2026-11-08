import { Link, Route, Routes } from "react-router";
import { HomePage } from "./pages/HomePage";
import { StatusPage } from "./pages/StatusPage";

export function App() {
  return (
    <div className="min-h-screen bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <nav className="mx-auto flex max-w-4xl items-center gap-6 px-4 py-3">
          <span className="font-semibold text-accent">Ledvara</span>
          <Link className="text-sm hover:text-accent" to="/">
            Home
          </Link>
          <Link className="text-sm hover:text-accent" to="/status">
            Status
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}
