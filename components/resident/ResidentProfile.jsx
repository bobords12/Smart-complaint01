"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Camera,
  UserRound,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Save,
  X,
  Pencil,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import toast from "react-hot-toast";
import { getResidentProfile, updateProfile, uploadAvatar, getAvatarUrl } from "@/repositories/profileRepository";
import { isPhMobileValid, isEmailValid } from "@/lib/authValidation";
import { createClient } from "@/lib/supabase/client";

const inputClass =
  "w-full rounded-xl border border-line bg-white dark:bg-canvas px-3.5 py-2.5 text-sm text-mirage outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted/60 focus:border-secondary focus:ring-2 focus:ring-secondary/20";

const labelClass = "mb-1.5 block text-[13px] font-semibold text-mirage";

const sectionCard =
  "rounded-2xl border border-line bg-white dark:bg-alt p-6 shadow-feather";

const FILE_ACCEPT = "image/jpeg,image/png,image/webp";
const MAX_FILE_SIZE = 5 * 1024 * 1024;

function mapProfileToForm(residentProfile, profileRow, avatarUrl, userEmail) {
  return {
    firstName: residentProfile?.first_name ?? "",
    middleName: residentProfile?.middle_name ?? "",
    lastName: residentProfile?.last_name ?? "",
    suffix: residentProfile?.suffix ?? "",
    dob: residentProfile?.date_of_birth ?? "",
    sex: residentProfile?.sex ?? "",
    houseNo: residentProfile?.house_street ?? "",
    purok: residentProfile?.purok ?? "",
    barangay: residentProfile?.barangay ?? "Abuno",
    city: residentProfile?.city ?? "Iligan City",
    mobile: residentProfile?.mobile_number ?? "",
    email: userEmail ?? "",
    photoUrl: avatarUrl ?? undefined,
  };
}

function mapFormToProfile(form) {
  return {
    first_name: form.firstName,
    middle_name: form.middleName,
    last_name: form.lastName,
    suffix: form.suffix,
    date_of_birth: form.dob,
    sex: form.sex,
    mobile_number: form.mobile,
    house_street: form.houseNo,
    purok: form.purok,
    barangay: form.barangay,
    city: form.city,
  };
}

function formatDisplayDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function getInitials(first, last) {
  const f = (first || "").charAt(0).toUpperCase();
  const l = (last || "").charAt(0).toUpperCase();
  return f + l || "?";
}

function validate(fields) {
  const errors = {};
  if (!fields.firstName.trim()) errors.firstName = "First name is required.";
  if (!fields.lastName.trim()) errors.lastName = "Last name is required.";
  if (!fields.dob) errors.dob = "Date of birth is required.";
  if (!fields.sex) errors.sex = "Sex is required.";
  if (!fields.houseNo.trim()) errors.houseNo = "House number / street is required.";
  if (!fields.purok.trim()) errors.purok = "Purok is required.";
  if (!fields.mobile.trim()) {
    errors.mobile = "Mobile number is required.";
  } else if (!isPhMobileValid(fields.mobile)) {
    errors.mobile = "Enter a valid Philippine mobile number (09XX XXX XXXX).";
  }
  if (!fields.email.trim()) {
    errors.email = "Email address is required.";
  } else if (!isEmailValid(fields.email)) {
    errors.email = "Enter a valid email address.";
  }
  return errors;
}

export default function ResidentProfile() {
  const fileRef = useRef(null);

  const [profile, setProfile] = useState(() => ({
    firstName: "", middleName: "", lastName: "", suffix: "",
    dob: "", sex: "", houseNo: "", purok: "", barangay: "Abuno",
    city: "Iligan City", mobile: "", email: "", photoUrl: undefined,
  }));
  const [draft, setDraft] = useState(profile);
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState({});
  const [previewUrl, setPreviewUrl] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [mounted, setMounted] = useState(false);
  const mountRef = useRef(false);
  const [userId, setUserId] = useState(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!mountRef.current) {
      mountRef.current = true;
      setMounted(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user || cancelled) return;

      setUserId(userData.user.id);

      const [residentProfile, profileRow] = await Promise.all([
        getResidentProfile(userData.user.id),
        (async () => {
          const { data } = await supabase
            .from("profiles")
            .select("display_name, avatar_path")
            .eq("id", userData.user.id)
            .single();
          return data;
        })(),
      ]);

      if (cancelled) return;

      const avatarUrl = profileRow?.avatar_path
        ? getAvatarUrl(profileRow.avatar_path)
        : null;
      const initial = mapProfileToForm(residentProfile, profileRow, avatarUrl, userData.user.email);
      setProfile(initial);
      setDraft(initial);
    }
    loadProfile();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const updateField = useCallback((field, value) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const handlePhotoChange = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        toast.error("Choose a JPG, PNG, or WebP image.");
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error("Image must be 5 MB or smaller.");
        return;
      }

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      setPhotoFile(file);
    },
    [previewUrl]
  );

  const handlePhotoUpload = useCallback(async () => {
    if (!photoFile || !userId || uploading) return;

    setUploading(true);
    const toastId = toast.loading("Uploading profile photo...");

    try {
      const result = await uploadAvatar(userId, photoFile);

      if (!result.success || !result.path) {
        toast.error(result.error || "Profile photo could not be uploaded.", { id: toastId });
        setUploading(false);
        return;
      }

      const avatarUrl = getAvatarUrl(result.path);

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setPhotoFile(null);
      if (fileRef.current) fileRef.current.value = "";

      setProfile((prev) => ({ ...prev, photoUrl: avatarUrl }));
      setDraft((prev) => ({ ...prev, photoUrl: avatarUrl }));

      toast.success("Profile photo updated.", { id: toastId });
    } catch {
      toast.error("Profile photo could not be uploaded.", { id: toastId });
    } finally {
      setUploading(false);
    }
  }, [photoFile, userId, uploading, previewUrl]);

  const removePhoto = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPhotoFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }, [previewUrl]);

  const enterEdit = useCallback(() => {
    setDraft(profile);
    setErrors({});
    setEditing(true);
  }, [profile]);

  const cancelEdit = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setDraft(profile);
    setErrors({});
    setPreviewUrl(null);
    setPhotoFile(null);
    setEditing(false);
    if (fileRef.current) fileRef.current.value = "";
  }, [profile, previewUrl]);

  const saveChanges = useCallback(async () => {
    const validationErrors = validate(draft);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      toast.error("Please fix the highlighted fields.");
      return;
    }

    if (!userId) {
      toast.error("Please sign in again.");
      return;
    }

    const toastId = toast.loading("Saving profile...");
    try {
      const profileUpdates = mapFormToProfile(draft);
      const result = await updateProfile(userId, profileUpdates);

      if (!result.success) {
        toast.error(result.error || "Failed to update profile.", { id: toastId });
        return;
      }

      const displayName = `${draft.firstName} ${draft.lastName}`.trim();
      if (displayName) {
        const supabase = createClient();
        await supabase.from("profiles").update({ display_name: displayName }).eq("id", userId);
      }

      setProfile(draft);
      setEditing(false);
      setErrors({});
      toast.success("Profile updated successfully!", { id: toastId });
    } catch {
      toast.error("An unexpected error occurred.", { id: toastId });
    }
  }, [draft, userId]);

  const initials = getInitials(profile.firstName, profile.lastName);
  const avatarSrc = mounted && (previewUrl || profile.photoUrl) ? previewUrl || profile.photoUrl : null;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-navy dark:text-secondary">
          Profile
        </h1>
        <p className="mt-1 text-sm text-muted">
          Manage your resident information.
        </p>
      </div>

      {/* Profile Photo */}
      <section className={sectionCard}>
        <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-navy dark:text-secondary">
          <ShieldCheck className="h-5 w-5 text-gold" aria-hidden="true" />
          Photo
        </h2>

        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          {/* Avatar */}
          <div className="relative shrink-0">
            <div className="h-24 w-24 overflow-hidden rounded-full border-2 border-line bg-alt">
              {avatarSrc ? (
                <img
                  src={avatarSrc}
                  alt="Profile photo"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-secondary/10">
                  <UserRound className="h-10 w-10 text-secondary" aria-hidden="true" />
                </div>
              )}
            </div>
          </div>

          {/* Full Name */}
          <div className="min-w-0">
            <p className="truncate font-heading text-xl font-bold tracking-tight text-navy dark:text-secondary">
              {[profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ") || "\u2014"}
            </p>
            {profile.email && (
              <p className="mt-0.5 truncate text-sm text-muted">{profile.email}</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor="photo-upload"
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-4 py-2 text-sm font-medium text-mirage transition-colors hover:bg-canvas focus-within:ring-2 focus-within:ring-secondary/20"
              >
                <Camera className="h-4 w-4" aria-hidden="true" />
                Choose Photo
              </label>
              <input
                ref={fileRef}
                id="photo-upload"
                type="file"
                accept={FILE_ACCEPT}
                onChange={handlePhotoChange}
                className="sr-only"
                aria-describedby="photo-hint"
              />
              {photoFile && (
                <button
                  type="button"
                  onClick={handlePhotoUpload}
                  disabled={uploading}
                  className="inline-flex items-center gap-2 rounded-xl bg-action px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Uploading...
                    </>
                  ) : (
                    "Upload"
                  )}
                </button>
              )}
            </div>
            <p id="photo-hint" className="text-xs text-muted">
              JPG, PNG, or WebP, max 5 MB.
            </p>
            {photoFile && (
              <button
                type="button"
                onClick={removePhoto}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-critical transition-colors hover:bg-critical-soft"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Cancel
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Personal Information */}
      <section className={sectionCard}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-navy dark:text-secondary">
            <UserRound className="h-5 w-5 text-gold" aria-hidden="true" />
            Personal
          </h2>
          {!editing && (
            <button
              type="button"
              onClick={enterEdit}
              className="inline-flex items-center gap-2 rounded-xl bg-action px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-secondary/30"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Edit
            </button>
          )}
        </div>

        {editing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="firstName" className={labelClass}>
                  First Name <span className="text-critical">*</span>
                </label>
                <input
                  id="firstName"
                  type="text"
                  value={draft.firstName}
                  onChange={(e) => updateField("firstName", e.target.value)}
                  className={`${inputClass} ${errors.firstName ? "border-critical focus:border-critical focus:ring-critical/20" : ""}`}
                  placeholder="Enter first name"
                />
                {errors.firstName && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-critical">
                    {errors.firstName}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="middleName" className={labelClass}>
                  Middle Name <span className="font-normal text-muted">(optional)</span>
                </label>
                <input
                  id="middleName"
                  type="text"
                  value={draft.middleName}
                  onChange={(e) => updateField("middleName", e.target.value)}
                  className={inputClass}
                  placeholder="Enter middle name"
                />
              </div>

              <div>
                <label htmlFor="lastName" className={labelClass}>
                  Last Name <span className="text-critical">*</span>
                </label>
                <input
                  id="lastName"
                  type="text"
                  value={draft.lastName}
                  onChange={(e) => updateField("lastName", e.target.value)}
                  className={`${inputClass} ${errors.lastName ? "border-critical focus:border-critical focus:ring-critical/20" : ""}`}
                  placeholder="Enter last name"
                />
                {errors.lastName && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-critical">
                    {errors.lastName}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="suffix" className={labelClass}>
                  Suffix <span className="font-normal text-muted">(optional)</span>
                </label>
                <input
                  id="suffix"
                  type="text"
                  value={draft.suffix}
                  onChange={(e) => updateField("suffix", e.target.value)}
                  className={inputClass}
                  placeholder="e.g. Jr., Sr., III"
                />
              </div>

              <div>
                <label htmlFor="dob" className={labelClass}>
                  Date of Birth <span className="text-critical">*</span>
                </label>
                <input
                  id="dob"
                  type="date"
                  value={draft.dob}
                  onChange={(e) => updateField("dob", e.target.value)}
                  className={`${inputClass} ${errors.dob ? "border-critical focus:border-critical focus:ring-critical/20" : ""}`}
                />
                {errors.dob && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-critical">
                    {errors.dob}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="sex" className={labelClass}>
                  Sex <span className="text-critical">*</span>
                </label>
                <select
                  id="sex"
                  value={draft.sex}
                  onChange={(e) => updateField("sex", e.target.value)}
                  className={`${inputClass} ${!draft.sex ? "text-muted/60" : ""} ${errors.sex ? "border-critical focus:border-critical focus:ring-critical/20" : ""}`}
                >
                  <option value="">Select sex</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
                {errors.sex && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-critical">
                    {errors.sex}
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldDisplay icon={<UserRound className="h-4 w-4 text-muted" />} label="First Name" value={profile.firstName || "\u2014"} />
            <FieldDisplay icon={<UserRound className="h-4 w-4 text-muted" />} label="Middle Name" value={profile.middleName || "\u2014"} />
            <FieldDisplay icon={<UserRound className="h-4 w-4 text-muted" />} label="Last Name" value={profile.lastName || "\u2014"} />
            <FieldDisplay icon={<UserRound className="h-4 w-4 text-muted" />} label="Suffix" value={profile.suffix || "\u2014"} />
            <FieldDisplay icon={<Calendar className="h-4 w-4 text-muted" />} label="Date of Birth" value={formatDisplayDate(profile.dob)} />
            <FieldDisplay icon={<UserRound className="h-4 w-4 text-muted" />} label="Sex" value={profile.sex || "\u2014"} />
          </div>
        )}
      </section>

      {/* Residential Address */}
      <section className={sectionCard}>
        <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-navy dark:text-secondary">
          <MapPin className="h-5 w-5 text-gold" aria-hidden="true" />
          Address
        </h2>

        {editing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="houseNo" className={labelClass}>
                  House Number / Street <span className="text-critical">*</span>
                </label>
                <input
                  id="houseNo"
                  type="text"
                  value={draft.houseNo}
                  onChange={(e) => updateField("houseNo", e.target.value)}
                  className={`${inputClass} ${errors.houseNo ? "border-critical focus:border-critical focus:ring-critical/20" : ""}`}
                  placeholder="e.g. 15 M. Roxas St."
                />
                {errors.houseNo && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-critical">
                    {errors.houseNo}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="purok" className={labelClass}>
                  Purok <span className="text-critical">*</span>
                </label>
                <input
                  id="purok"
                  type="text"
                  value={draft.purok}
                  onChange={(e) => updateField("purok", e.target.value)}
                  className={`${inputClass} ${errors.purok ? "border-critical focus:border-critical focus:ring-critical/20" : ""}`}
                  placeholder="e.g. Purok 3"
                />
                {errors.purok && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-critical">
                    {errors.purok}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="barangay" className={labelClass}>
                  Barangay
                </label>
                <input
                  id="barangay"
                  type="text"
                  value={draft.barangay}
                  readOnly
                  className={`${inputClass} cursor-not-allowed bg-canvas/60 text-muted`}
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="city" className={labelClass}>
                  City
                </label>
                <input
                  id="city"
                  type="text"
                  value={draft.city}
                  readOnly
                  className={`${inputClass} cursor-not-allowed bg-canvas/60 text-muted`}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldDisplay icon={<MapPin className="h-4 w-4 text-muted" />} label="House Number / Street" value={profile.houseNo || "\u2014"} full />
            <FieldDisplay icon={<MapPin className="h-4 w-4 text-muted" />} label="Purok" value={profile.purok || "\u2014"} />
            <FieldDisplay icon={<MapPin className="h-4 w-4 text-muted" />} label="Barangay" value={profile.barangay || "\u2014"} />
            <FieldDisplay icon={<MapPin className="h-4 w-4 text-muted" />} label="City" value={profile.city || "\u2014"} />
          </div>
        )}
      </section>

      {/* Contact Information */}
      <section className={sectionCard}>
        <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-navy dark:text-secondary">
          <Phone className="h-5 w-5 text-gold" aria-hidden="true" />
          Contact
        </h2>

        {editing ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="mobile" className={labelClass}>
                Mobile Number <span className="text-critical">*</span>
              </label>
              <input
                id="mobile"
                type="tel"
                value={draft.mobile}
                onChange={(e) => updateField("mobile", e.target.value)}
                className={`${inputClass} ${errors.mobile ? "border-critical focus:border-critical focus:ring-critical/20" : ""}`}
                placeholder="09XX XXX XXXX"
              />
              {errors.mobile && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-critical">
                  {errors.mobile}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="email" className={labelClass}>
                Email Address <span className="text-critical">*</span>
              </label>
              <input
                id="email"
                type="email"
                value={draft.email}
                onChange={(e) => updateField("email", e.target.value)}
                className={`${inputClass} ${errors.email ? "border-critical focus:border-critical focus:ring-critical/20" : ""}`}
                placeholder="you@example.com"
              />
              {errors.email && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-critical">
                  {errors.email}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldDisplay icon={<Phone className="h-4 w-4 text-muted" />} label="Mobile Number" value={profile.mobile || "\u2014"} />
            <FieldDisplay icon={<Mail className="h-4 w-4 text-muted" />} label="Email Address" value={profile.email || "\u2014"} />
          </div>
        )}
      </section>

      {/* Save / Cancel Bar */}
      {editing && (
        <div className="flex items-center justify-end gap-3 rounded-2xl border border-line bg-white px-6 py-4 shadow-feather">
          <button
            type="button"
            onClick={cancelEdit}
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-5 py-2.5 text-sm font-semibold text-mirage transition-colors hover:bg-canvas focus:outline-none focus:ring-2 focus:ring-secondary/30"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Cancel
          </button>
          <button
            type="button"
            onClick={saveChanges}
            className="inline-flex items-center gap-2 rounded-xl bg-action px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-secondary/30"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            Save
          </button>
        </div>
      )}
    </div>
  );
}

function FieldDisplay({ icon, label, value, full = false }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <span className="mb-1 flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-muted">
        {icon}
        {label}
      </span>
      <div className="flex items-center gap-2 rounded-xl border border-transparent bg-canvas px-3.5 py-2.5 text-sm text-mirage">
        {value}
      </div>
    </div>
  );
}
