import { ShieldCheck } from "lucide-react";

export default function AuthSecurityNote({
  text = "Secure access with role-based authentication.",
}) {
  return (
    <p className="mt-5 flex items-start gap-2.5 rounded-[10px] bg-alt px-3.5 py-3 text-[12.5px] leading-relaxed text-secondary">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}