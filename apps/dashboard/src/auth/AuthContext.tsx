import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { authApi, type AuthApi, type LoginOutcome, type User } from "../lib/auth-api";

type AuthState =
  { status: "loading" } | { status: "signedOut" } | { status: "signedIn"; user: User };

interface AuthValue {
  status: AuthState["status"];
  user: User | null;
  login(email: string, password: string): Promise<LoginOutcome>;
  completeTwoFactor(challengeToken: string, code: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ api = authApi, children }: { api?: AuthApi; children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    const off = api.onSignedOut(() => {
      if (active) setState({ status: "signedOut" });
    });
    void api.restore().then((user) => {
      if (active) setState(user ? { status: "signedIn", user } : { status: "signedOut" });
    });
    return () => {
      active = false;
      off();
    };
  }, [api]);

  const login = useCallback(
    async (email: string, password: string) => {
      const outcome = await api.login(email, password);
      if (outcome.kind === "signedIn") setState({ status: "signedIn", user: outcome.user });
      return outcome;
    },
    [api],
  );

  const completeTwoFactor = useCallback(
    async (challengeToken: string, code: string) => {
      const user = await api.completeTwoFactor(challengeToken, code);
      setState({ status: "signedIn", user });
    },
    [api],
  );

  const logout = useCallback(async () => {
    await api.logout();
    setState({ status: "signedOut" });
  }, [api]);

  const value = useMemo<AuthValue>(
    () => ({
      status: state.status,
      user: state.status === "signedIn" ? state.user : null,
      login,
      completeTwoFactor,
      logout,
    }),
    [state, login, completeTwoFactor, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside an AuthProvider");
  return value;
}
