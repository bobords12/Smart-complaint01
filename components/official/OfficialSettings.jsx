"use client";

import { useState, useCallback } from "react";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { getPortalRoleLabel } from "@/lib/permissions";
import {
  Settings,
  User,
  Lock,
  Bell,
  Eye,
  ShieldCheck,
  Loader2,
} from "lucide-react";

function Toggle({ checked, onChange, disabled, label, id }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-secondary ${
          checked ? "bg-action" : "bg-line"
        } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
      <span className="text-sm font-medium text-mirage">{label}</span>
    </label>
  );
}

function SectionCard({ icon: Icon, title, children }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)] sm:p-6">
      <header className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-info-soft">
          <Icon className="h-5 w-5 text-secondary" aria-hidden="true" />
        </span>
        <h2 className="font-heading text-base font-semibold tracking-tight text-navy">
          {title}
        </h2>
      </header>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function mapSupabaseError(message) {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login") || lower.includes("wrong password") || lower.includes("incorrect")) {
    return "Current password is incorrect.";
  }
  if (lower.includes("same password")) {
    return "New password must be different from your current password.";
  }
  if (lower.includes("password") && (lower.includes("short") || lower.includes("length"))) {
    return "Password must contain at least 8 characters.";
  }
  if (lower.includes("password") && lower.includes("weak")) {
    return "Choose a stronger password.";
  }
  if (lower.includes("session") || lower.includes("expired") || lower.includes("unauthorized")) {
    return "Please sign in again.";
  }
  if (lower.includes("rate limit")) {
    return "Too many attempts. Please try again later.";
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return "Network error. Please check your connection.";
  }
  return "Password could not be updated.";
}

/**
 * The notification toggles shown on this page.
 *
 * Exported so another portal sharing this component can supply the
 * labels that make sense for it. A PNP officer is notified about
 * referral assignments and information replies, never about hearings,
 * so the PNP settings page passes its own set. The default below is
 * unchanged for the Captain / OIC / Secretary pages.
 *
 * These toggles are a local preference in this build and are not yet
 * persisted; the password change below is the only part of this page
 * that writes anything.
 */
export const OFFICIAL_NOTIFICATION_OPTIONS = [
  { key: "complaintUpdates", label: "Complaint updates" },
  { key: "hearingReminders", label: "Hearing reminders" },
  { key: "caseAssignments", label: "Case assignments" },
  { key: "generalNotices", label: "General notices" },
];

export default function CaptainSettingsPage({
  notificationOptions = OFFICIAL_NOTIFICATION_OPTIONS,
}) {
  const { user } = useAuth();

  const [notifications, setNotifications] = useState({
    complaintUpdates: true,
    hearingReminders: true,
    caseAssignments: true,
    generalNotices: true,
  });
  const [accessibility, setAccessibility] = useState({
    reducedMotion: false,
    increasedTextSize: false,
  });

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordErrors, setPasswordErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const updateNotification = useCallback((key, value) => {
    setNotifications((prev) => ({ ...prev, [key]: value }));
  }, []);

  const updateAccessibility = useCallback((key, value) => {
    setAccessibility((prev) => ({ ...prev, [key]: value }));
  }, []);

  const validatePassword = useCallback(() => {
    const next = {};

    if (!currentPassword.trim()) {
      next.currentPassword = "Enter your current password.";
    }

    if (!newPassword.trim()) {
      next.newPassword = "Enter a new password.";
    } else if (newPassword.length < 8) {
      next.newPassword = "Password must contain at least 8 characters.";
    } else if (newPassword === currentPassword) {
      next.newPassword = "New password must be different from your current password.";
    }

    if (!confirmPassword.trim()) {
      next.confirmPassword = "Confirm your new password.";
    } else if (confirmPassword !== newPassword) {
      next.confirmPassword = "Passwords do not match.";
    }

    setPasswordErrors(next);
    return Object.keys(next).length === 0;
  }, [currentPassword, newPassword, confirmPassword]);

  const clearFieldError = useCallback((field) => {
    setPasswordErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const handlePasswordSubmit = useCallback(
    async (e) => {
      e.preventDefault();

      if (!validatePassword()) {
        const firstField = document.querySelector('[aria-invalid="true"]');
        firstField?.focus();
        return;
      }

      setSubmitting(true);
      const toastId = toast.loading("Updating password...");

      try {
        const supabase = createClient();
        const { data: userData, error: userError } = await supabase.auth.getUser();

        if (userError || !userData.user) {
          toast.dismiss(toastId);
          toast.error("Please sign in again.");
          return;
        }

        const authUser = userData.user;
        if (!authUser.email) {
          toast.dismiss(toastId);
          toast.error("Please sign in again.");
          return;
        }

        const { error: verifyError } = await supabase.auth.signInWithPassword({
          email: authUser.email,
          password: currentPassword,
        });

        if (verifyError) {
          toast.dismiss(toastId);
          toast.error(mapSupabaseError(verifyError.message));
          return;
        }

        const { error: updateError } = await supabase.auth.updateUser({
          password: newPassword,
        });

        toast.dismiss(toastId);

        if (updateError) {
          console.error("Password update error:", updateError.message);
          toast.error(mapSupabaseError(updateError.message));
          return;
        }

        toast.success("Password updated successfully.");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setPasswordErrors({});
      } catch (err) {
        toast.dismiss(toastId);
        console.error("Unexpected password update error:", err);
        toast.error("An unexpected error occurred.");
      } finally {
        setSubmitting(false);
      }
    },
    [currentPassword, newPassword, confirmPassword, validatePassword]
  );

  return (
    <div className="mx-auto max-w-[800px] space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-secondary" />
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-navy">
            Settings
          </h1>
          <p className="text-[13px] text-muted">
            Manage your account preferences.
          </p>
        </div>
      </div>

      {/* Profile Info */}
      <SectionCard icon={User} title="Profile">
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-info-soft text-lg font-bold text-secondary">
              {user?.fullName?.charAt(0)?.toUpperCase() || "O"}
            </span>
            <div>
              <p className="font-heading text-lg font-semibold text-navy">
                {user?.fullName || "Official"}
              </p>
              <p className="text-[13px] text-muted">{user?.email || "—"}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-line pt-4 sm:grid-cols-2">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">
                Role
              </p>
              <p className="mt-1 text-navy">
                {getPortalRoleLabel(user?.role) || "Official"}
              </p>
            </div>
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">
                Account Status
              </p>
              <p className="mt-1 text-navy">Active</p>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Notification Preferences */}
      <SectionCard icon={Bell} title="Notifications">
        <div className="space-y-4">
          {notificationOptions.map((option) => (
            <Toggle
              key={option.key}
              id={`notif-${option.key}`}
              checked={Boolean(notifications[option.key])}
              onChange={(v) => updateNotification(option.key, v)}
              label={option.label}
            />
          ))}
        </div>
      </SectionCard>

      {/* Password */}
      <SectionCard icon={Lock} title="Password">
        <p className="text-[13px] text-muted">
          Update the password used to access your account.
        </p>

        <form onSubmit={handlePasswordSubmit} noValidate className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="capt-current-password"
              className="mb-1.5 block text-[13px] font-semibold text-mirage"
            >
              Current Password
              <span aria-hidden="true" className="ml-0.5 text-critical">*</span>
            </label>
            <input
              id="capt-current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                clearFieldError("currentPassword");
              }}
              placeholder="Enter current password"
              autoComplete="current-password"
              aria-invalid={!!passwordErrors.currentPassword}
              aria-describedby={
                passwordErrors.currentPassword
                  ? "capt-current-password-error"
                  : undefined
              }
              disabled={submitting}
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy placeholder:text-muted focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20 disabled:opacity-50"
            />
            {passwordErrors.currentPassword ? (
              <p
                id="capt-current-password-error"
                className="mt-1.5 text-[12.5px] font-medium text-critical"
              >
                {passwordErrors.currentPassword}
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="capt-new-password"
              className="mb-1.5 block text-[13px] font-semibold text-mirage"
            >
              New Password
              <span aria-hidden="true" className="ml-0.5 text-critical">*</span>
            </label>
            <input
              id="capt-new-password"
              type="password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                clearFieldError("newPassword");
              }}
              placeholder="Enter new password"
              autoComplete="new-password"
              aria-invalid={!!passwordErrors.newPassword}
              aria-describedby={
                passwordErrors.newPassword
                  ? "capt-new-password-error"
                  : undefined
              }
              disabled={submitting}
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy placeholder:text-muted focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20 disabled:opacity-50"
            />
            {passwordErrors.newPassword ? (
              <p
                id="capt-new-password-error"
                className="mt-1.5 text-[12.5px] font-medium text-critical"
              >
                {passwordErrors.newPassword}
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="capt-confirm-password"
              className="mb-1.5 block text-[13px] font-semibold text-mirage"
            >
              Confirm New Password
              <span aria-hidden="true" className="ml-0.5 text-critical">*</span>
            </label>
            <input
              id="capt-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                clearFieldError("confirmPassword");
              }}
              placeholder="Confirm new password"
              autoComplete="new-password"
              aria-invalid={!!passwordErrors.confirmPassword}
              aria-describedby={
                passwordErrors.confirmPassword
                  ? "capt-confirm-password-error"
                  : undefined
              }
              disabled={submitting}
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy placeholder:text-muted focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20 disabled:opacity-50"
            />
            {passwordErrors.confirmPassword ? (
              <p
                id="capt-confirm-password-error"
                className="mt-1.5 text-[12.5px] font-medium text-critical"
              >
                {passwordErrors.confirmPassword}
              </p>
            ) : null}
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-navy px-8 text-sm font-semibold text-white transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Updating...
                </>
              ) : (
                "Update Password"
              )}
            </button>
          </div>
        </form>
      </SectionCard>

      {/* Accessibility */}
      <SectionCard icon={Eye} title="Accessibility">
        <div className="space-y-4">
          <Toggle
            id="capt-a11y-motion"
            checked={accessibility.reducedMotion}
            onChange={(v) => updateAccessibility("reducedMotion", v)}
            label="Reduced motion"
          />
          <Toggle
            id="capt-a11y-text"
            checked={accessibility.increasedTextSize}
            onChange={(v) => updateAccessibility("increasedTextSize", v)}
            label="Larger text"
          />
        </div>
      </SectionCard>
    </div>
  );
}
