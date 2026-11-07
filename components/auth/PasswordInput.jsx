"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { errorInputClass, normalInputClass } from "./FormField";

export default function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete,
  invalid = false,
  describedBy,
  disabled = false,
}) {
  const [visible, setVisible] = useState(false);
  const inputClassName = invalid ? errorInputClass : normalInputClass;

  return (
    <div className="relative">
      <input
        id={id}
        name={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy || undefined}
        className={`${inputClassName} pr-12`}
      />
      <button
        type="button"
        onClick={() => setVisible((open) => !open)}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-1.5 my-auto flex h-9 w-9 items-center justify-center rounded-[8px] text-muted transition-colors hover:bg-alt hover:text-navy dark:hover:text-secondary focus-visible:outline-2 focus-visible:outline-secondary"
      >
        {visible ? (
          <EyeOff className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Eye className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}