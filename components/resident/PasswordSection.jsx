"use client";

import { useState, useCallback } from "react";
import toast from "react-hot-toast";
import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import PasswordInput from "@/components/auth/PasswordInput";
import {
  MIN_PASSWORD_LENGTH,
  hasMinPasswordLength,
} from "@/lib/authValidation";

const SectionCard = ({ icon: Icon, title, children }) => (
  <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)] dark:bg-alt dark:shadow-[0_1px_2px_rgba(0,0,0,0.3)] sm:p-6">
    <header className="flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-info-soft">
        <Icon className="h-5 w-5 text-secondary" aria-hidden="true" />
      </span>
      <h2 className="font-heading text-base font-semibold tracking-tight text-navy dark:text-secondary">
        {title}
      </h2>
    </header>
    <div className="mt-5">{children}</div>
  </section>
);

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

export default function PasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const validate = useCallback(() => {
    const next = {};

    if (!currentPassword.trim()) {
      next.currentPassword = "Enter your current password.";
    }

    if (!newPassword.trim()) {
      next.newPassword = "Enter a new password.";
    } else if (!hasMinPasswordLength(newPassword)) {
      next.newPassword = `Password must contain at least ${MIN_PASSWORD_LENGTH} characters.`;
    } else if (newPassword === currentPassword) {
      next.newPassword = "New password must be different from your current password.";
    }

    if (!confirmPassword.trim()) {
      next.confirmPassword = "Confirm your new password.";
    } else if (confirmPassword !== newPassword) {
      next.confirmPassword = "Passwords do not match.";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }, [currentPassword, newPassword, confirmPassword]);

  const clearFieldError = useCallback((field) => {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();

    if (!validate()) {
      const firstField = document.querySelector('[aria-invalid="true"]');
      firstField?.focus();
      return;
    }

    setSubmitting(true);
    const toastId = toast.loading("Updating password…");

    try {
      const supabase = createClient();
      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (userError || !userData.user) {
        toast.dismiss(toastId);
        toast.error("Please sign in again.");
        return;
      }

      const user = userData.user;
      if (!user.email) {
        toast.dismiss(toastId);
        toast.error("Please sign in again.");
        return;
      }

      // Verify current password by attempting reauthentication
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });

      if (verifyError) {
        toast.dismiss(toastId);
        toast.error(mapSupabaseError(verifyError.message));
        return;
      }

      // Update to the new password
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
      setErrors({});
    } catch (err) {
      toast.dismiss(toastId);
      console.error("Unexpected password update error:", err);
      toast.error("An unexpected error occurred.");
    } finally {
      setSubmitting(false);
    }
  }, [currentPassword, newPassword, confirmPassword, validate]);

  return (
    <SectionCard icon={Lock} title="Password">
      <p className="text-[13px] text-muted">
        Update the password used to access your account.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
        <div>
          <label
            htmlFor="current-password"
            className="mb-1.5 block text-[13px] font-semibold text-mirage"
          >
            Current Password
            <span aria-hidden="true" className="ml-0.5 text-critical">*</span>
          </label>
          <PasswordInput
            id="current-password"
            value={currentPassword}
            onChange={(e) => {
              setCurrentPassword(e.target.value);
              clearFieldError("currentPassword");
            }}
            placeholder="Enter current password"
            autoComplete="current-password"
            invalid={!!errors.currentPassword}
            describedBy={errors.currentPassword ? "current-password-error" : undefined}
            disabled={submitting}
          />
          {errors.currentPassword ? (
            <p
              id="current-password-error"
              className="mt-1.5 flex items-start gap-1.5 text-[12.5px] font-medium leading-snug text-critical"
            >
              <span>{errors.currentPassword}</span>
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="new-password"
            className="mb-1.5 block text-[13px] font-semibold text-mirage"
          >
            New Password
            <span aria-hidden="true" className="ml-0.5 text-critical">*</span>
          </label>
          <PasswordInput
            id="new-password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              clearFieldError("newPassword");
            }}
            placeholder="Enter new password"
            autoComplete="new-password"
            invalid={!!errors.newPassword}
            describedBy={errors.newPassword ? "new-password-error" : undefined}
            disabled={submitting}
          />
          {errors.newPassword ? (
            <p
              id="new-password-error"
              className="mt-1.5 flex items-start gap-1.5 text-[12.5px] font-medium leading-snug text-critical"
            >
              <span>{errors.newPassword}</span>
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="confirm-password"
            className="mb-1.5 block text-[13px] font-semibold text-mirage"
          >
            Confirm New Password
            <span aria-hidden="true" className="ml-0.5 text-critical">*</span>
          </label>
          <PasswordInput
            id="confirm-password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              clearFieldError("confirmPassword");
            }}
            placeholder="Confirm new password"
            autoComplete="new-password"
            invalid={!!errors.confirmPassword}
            describedBy={errors.confirmPassword ? "confirm-password-error" : undefined}
            disabled={submitting}
          />
          {errors.confirmPassword ? (
            <p
              id="confirm-password-error"
              className="mt-1.5 flex items-start gap-1.5 text-[12.5px] font-medium leading-snug text-critical"
            >
              <span>{errors.confirmPassword}</span>
            </p>
          ) : null}
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-navy px-8 text-sm font-semibold text-white transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting ? "Updating…" : "Update Password"}
          </button>
        </div>
      </form>
    </SectionCard>
  );
}
