export type AppRole =
  | "resident"
  | "captain"
  | "oic"
  | "secretary"
  | "lupon"
  | "pnp_officer"
  | "staff"
  | "police"
  | "admin";

export type AccountStatus = "pending" | "active" | "suspended" | "disabled";

export interface Profile {
  id: string;
  role: AppRole;
  display_name: string | null;
  avatar_path: string | null;
  account_status: AccountStatus;
  first_login_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface ResidentProfile {
  id: string;
  user_id: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  suffix: string;
  date_of_birth: string;
  sex: string;
  mobile_number: string;
  house_street: string;
  purok: string;
  barangay: string;
  city: string;
  verification_status: string;
  created_at: string;
  updated_at: string;
}

export interface Resident {
  id: string;
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
  dob: string;
  sex: string;
  houseNo: string;
  purok: string;
  barangay: string;
  city: string;
  mobile: string;
  email: string;
  password: string;
  role: "resident";
  createdAt: string;
}

export interface AuthSession {
  id: string;
  email: string;
  fullName: string;
  firstName: string;
  lastName: string;
  role: AppRole;
  firstLoginCompleted: boolean;
  isAuthenticated: true;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegistrationData {
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
  dob: string;
  sex: string;
  houseNo: string;
  purok: string;
  barangay: string;
  city: string;
  mobile: string;
  email: string;
  password: string;
  confirmPassword: string;
}
