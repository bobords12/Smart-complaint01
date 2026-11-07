import AuthRedirect from "@/components/auth/AuthRedirect";
import AuthLayout from "@/components/auth/AuthLayout";
import AuthCard from "@/components/auth/AuthCard";
import AuthSecurityNote from "@/components/auth/AuthSecurityNote";
import RegisterForm from "@/components/auth/RegisterForm";

export const metadata = {
  title: { absolute: "Register | SCBMS Barangay Abuno" },
  description:
    "Create a resident account for the Smart Complaint and Blotter Management System — file complaints, receive hearing notices, and track your case progress in Barangay Abuno, Iligan City.",
};

export default function RegisterPage() {
  return (
    <AuthRedirect>
      <AuthLayout maxWidthClass="max-w-[640px]">
        <AuthCard
          topLabel="RESIDENT REGISTRATION"
          title="Create your resident account"
          titleId="auth-register-title"
          subtitle="Register to file complaints, receive hearing notices, and track your case progress."
        >
          <RegisterForm />
          <AuthSecurityNote text="Accounts are activated only after an authorized barangay official verifies them." />
        </AuthCard>
      </AuthLayout>
    </AuthRedirect>
  );
}
