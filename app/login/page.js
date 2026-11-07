import AuthRedirect from "@/components/auth/AuthRedirect";
import AuthLayout from "@/components/auth/AuthLayout";
import AuthCard from "@/components/auth/AuthCard";
import AuthSecurityNote from "@/components/auth/AuthSecurityNote";
import LoginForm from "@/components/auth/LoginForm";

export const metadata = {
  title: { absolute: "Login | SCBMS Barangay Abuno" },
  description:
    "Sign in to the Smart Complaint and Blotter Management System for Barangay Abuno, Iligan City — residents, the Barangay Captain/OIC, the Secretary, and Lupon members.",
};

export default function LoginPage() {
  return (
    <AuthRedirect>
      <AuthLayout>
        <AuthCard
          topLabel="SECURE ACCESS"
          welcome="WELCOME!"
          title="Sign in with your email and password"
          titleId="auth-login-title"
          subtitle="Use your resident or authorized barangay account to continue."
        >
          <LoginForm />
          <AuthSecurityNote />
        </AuthCard>
      </AuthLayout>
    </AuthRedirect>
  );
}
