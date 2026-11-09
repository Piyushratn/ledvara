import { Link, Route, Routes, useNavigate } from "react-router";
import { RequireAuth } from "./auth/RequireAuth";
import { useAuth } from "./auth/AuthContext";
import { OrgLayout } from "./components/OrgLayout";
import { ThemeToggle } from "./components/ThemeToggle";
import { AppPage } from "./pages/AppPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { OverviewPage } from "./pages/OverviewPage";
import { SignUpPage } from "./pages/SignUpPage";
import { StatusPage } from "./pages/StatusPage";
import { VerifyEmailPage } from "./pages/VerifyEmailPage";

export function App() {
  const { status, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <span className="font-semibold text-accent">Ledvara</span>
          <Link className="text-sm hover:text-accent" to="/">
            Home
          </Link>
          <Link className="text-sm hover:text-accent" to="/status">
            Status
          </Link>
          <span className="flex-1" />
          <ThemeToggle />
          {status === "signedIn" ? (
            <>
              <Link className="text-sm hover:text-accent" to="/app">
                Account
              </Link>
              <button
                type="button"
                className="text-sm hover:text-accent"
                onClick={() => void logout().then(() => navigate("/"))}
              >
                Sign out
              </button>
            </>
          ) : null}
          {status === "signedOut" ? (
            <>
              <Link className="text-sm hover:text-accent" to="/login">
                Sign in
              </Link>
              <Link className="text-sm hover:text-accent" to="/signup">
                Sign up
              </Link>
            </>
          ) : null}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/app" element={<AppPage />} />
            <Route path="/orgs/:orgId" element={<OrgLayout />}>
              <Route index element={<OverviewPage />} />
              <Route path="onboarding" element={<OnboardingPage />} />
            </Route>
          </Route>
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}
