"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import FormField, { errorInputClass, normalInputClass } from "./FormField";
import PasswordInput from "./PasswordInput";
import SubmitButton from "./SubmitButton";
import { ROUTES } from "@/lib/constants";
import { LOGIN_FIELD_ORDER } from "@/data/authSampleData";
import { isEmailValid, MIN_PASSWORD_LENGTH } from "@/lib/authValidation";
import { useAuth } from "@/context/AuthContext";
import { getPostLoginRoute } from "@/lib/roleRoutes";

export default function LoginForm({ onSwitchView }) {
  const router = useRouter();
  const { login, markFirstLoginCompleted } = useAuth();
  const [values, setValues] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const updateField = (key) => (event) => {
    setValues((current) => ({ ...current, [key]: event.target.value }));
    if (errors[key]) {
      setErrors((current) => ({ ...current, [key]: "" }));
    }
    if (serverError) setServerError("");
  };

  const validate = () => {
    const next = {};
    const email = values.email.trim();
    if (!email) {
      next.email = "Email address is required.";
    } else if (!isEmailValid(email)) {
      next.email = "Enter a valid email address, e.g. you@email.com.";
    }
    if (!values.password) {
      next.password = "Password is required.";
    } else if (values.password.length < MIN_PASSWORD_LENGTH) {
      next.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    return next;
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      const firstInvalid = LOGIN_FIELD_ORDER.find((key) => nextErrors[key]);
      if (firstInvalid) document.getElementById(firstInvalid)?.focus();
      return;
    }

    setErrors({});
    setServerError("");
    setSubmitting(true);
    const toastId = toast.loading("Signing you in...");

    const result = await login({ email: values.email.trim(), password: values.password });

    if (result.success) {
      if (result.role === "oic") {
        toast.success("Welcome, OIC.", { id: toastId });
      } else if (result.role === "secretary") {
        toast.success("Welcome, Secretary.", { id: toastId });
      } else if (!result.firstLoginCompleted) {
        toast.success("Welcome!", { id: toastId });
      } else {
        toast.success("Welcome back!", { id: toastId });
      }
      if (!result.firstLoginCompleted) {
        markFirstLoginCompleted();
      }
      const redirectRoute = getPostLoginRoute(result.role || "resident");
      router.replace(redirectRoute);
    } else {
      toast.error(result.error || "Unable to sign in. Check your credentials.", { id: toastId });
      setServerError(result.error || "Login failed. Please try again.");
      setSubmitting(false);
    }
  };

  const emailErrorId = errors.email ? "email-error" : undefined;
  const passwordErrorId = errors.password ? "password-error" : undefined;

  return (
    <div>
      {serverError ? (
        <p
          role="alert"
          className="mb-4 flex items-start gap-2.5 rounded-[10px] border border-critical/25 bg-critical/10 px-3.5 py-3 text-[13px] font-medium leading-relaxed text-critical"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-critical" aria-hidden="true" />
          <span>{serverError}</span>
        </p>
      ) : null}

      {Object.keys(errors).length > 0 ? (
        <p
          role="alert"
          className="mb-4 flex items-start gap-2.5 rounded-[10px] border border-critical/25 bg-critical/10 px-3.5 py-3 text-[13px] font-medium leading-relaxed text-critical"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-critical" aria-hidden="true" />
          <span>Please fix the highlighted fields below and try again.</span>
        </p>
      ) : null}

      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormField id="email" label="Email Address" required error={errors.email}>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={values.email}
            onChange={updateField("email")}
            placeholder="you@email.com"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={emailErrorId}
            className={errors.email ? errorInputClass : normalInputClass}
          />
        </FormField>

        <FormField id="password" label="Password" required error={errors.password}>
          <PasswordInput
            id="password"
            value={values.password}
            onChange={updateField("password")}
            placeholder="Enter your password"
            autoComplete="current-password"
            invalid={Boolean(errors.password)}
            describedBy={passwordErrorId}
          />
        </FormField>

        <div className="pt-1">
          <SubmitButton loading={submitting} loadingText="Signing in...">
            Sign In
          </SubmitButton>
        </div>
      </form>

      <div className="mt-6 space-y-3 text-center text-sm text-muted">
        <p>
          Don&apos;t have an account?{" "}
          {onSwitchView ? (
            <button
              type="button"
              onClick={() => onSwitchView("register")}
              className="font-semibold text-secondary transition-colors hover:text-navy dark:hover:text-secondary"
            >
              Register
            </button>
          ) : (
            <Link
              href={ROUTES.register}
              className="font-semibold text-secondary transition-colors hover:text-navy dark:hover:text-secondary"
            >
              Register
            </Link>
          )}
        </p>
      </div>
    </div>
  );
}
