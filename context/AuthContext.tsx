"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { AppRole, AuthSession, LoginCredentials, RegistrationData } from "@/types/auth";
import {
  loginResident,
  logoutResident,
  registerResident,
  getCurrentSession,
} from "@/services/authService";

interface AuthContextValue {
  user: AuthSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginCredentials) => Promise<{
    success: boolean;
    error?: string;
    firstLoginCompleted?: boolean;
    role?: AppRole;
  }>;
  register: (data: RegistrationData) => Promise<{ success: boolean; error?: string; requiresConfirmation?: boolean }>;
  logout: () => void;
  refreshSession: () => Promise<void>;
  markFirstLoginCompleted: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    getCurrentSession()
      .then((session) => {
        setUser(session);
        setIsLoading(false);
      })
      .catch(() => {
        setIsLoading(false);
      });
  }, []);

  const refreshSession = useCallback(async () => {
    const session = await getCurrentSession();
    setUser(session);
  }, []);

  const login = useCallback(async (credentials: LoginCredentials) => {
    const result = await loginResident(credentials);
    if (result.success && result.session) {
      setUser(result.session);
      return { success: true, error: undefined, firstLoginCompleted: result.session.firstLoginCompleted, role: result.session.role };
    }
    return { success: result.success, error: result.error, firstLoginCompleted: false, role: undefined };
  }, []);

  const register = useCallback(async (data: RegistrationData) => {
    return registerResident(data);
  }, []);

  const logout = useCallback(async () => {
    await logoutResident();
    setUser(null);
  }, []);

  const markFirstLoginCompleted = useCallback(async () => {
    if (!user) return;
    const supabase = (await import("@/lib/supabase/client")).createClient();
    await supabase
      .from("profiles")
      .update({ first_login_completed: true })
      .eq("id", user.id);
    setUser((prev) => (prev ? { ...prev, firstLoginCompleted: true } : prev));
  }, [user]);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isLoading,
      login,
      register,
      logout,
      refreshSession,
      markFirstLoginCompleted,
    }),
    [user, isLoading, login, register, logout, refreshSession, markFirstLoginCompleted]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
