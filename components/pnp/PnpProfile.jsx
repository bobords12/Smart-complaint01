"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import toast from "react-hot-toast";
import { Camera, ShieldCheck, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getAvatarUrl,
  getInitials,
  updateProfileDisplay,
  uploadAvatar,
} from "@/repositories/profileRepository";
import { fetchMyAssignments } from "@/repositories/pnpReferralRepository";
import { useAuth } from "@/context/AuthContext";
import { formatDate } from "@/lib/pnpReferral";
import {
  BoundaryNote,
  DetailField,
  LoadingBlock,
  PnpPageHeader,
  TextField,
} from "./PnpPrimitives";

/**
 * The officer's own profile.
 *
 * Two things are editable here: the display name and the avatar, both
 * on public.profiles, which every portal reads. Everything else on
 * this page is read-only, and the read-only parts matter as much as
 * the editable ones — an officer can see their rank, unit and station
 * so they can tell whether the barangay has recorded them correctly,
 * but they cannot change any of it.
 *
 * pnp_officer_profiles and pnp_officer_units have no INSERT or UPDATE
 * policy at all, so a write attempt from this page would be refused by
 * the database. The buttons are absent rather than disabled-and-
 * explained, because an officer cannot act on the explanation.
 */
export default function PnpProfile() {
  const { user, refresh } = useAuth();
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [avatarPath, setAvatarPath] = useState(null);
  const [officerRow, setOfficerRow] = useState(null);
  const [units, setUnits] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [assignmentsUnavailable, setAssignmentsUnavailable] = useState(false);

  // Read directly in the effect rather than through a useCallback.
  // The callback existed only to be a dependency of the effect below,
  // and the compiler could not preserve that memoization once the
  // async body captured the auth user. The fetch runs once per
  // identity change either way.
  useEffect(() => {
    let cancelled = false;
    const userId = user?.id;
    if (!userId) return undefined;

    (async () => {
      const supabase = createClient();

      const [profileRes, officerRes, unitRes, assignmentRes] = await Promise.all([
        supabase.from("profiles").select("display_name, avatar_path").eq("id", userId).maybeSingle(),
        supabase
          .from("pnp_officer_profiles")
          .select("rank, unit_name, station_name, personnel_number, contact_number")
          .eq("id", userId)
          .maybeSingle(),
        supabase
          .from("pnp_officer_units")
          .select("unit_id, is_primary")
          .eq("officer_id", userId),
        fetchMyAssignments(),
      ]);

      if (cancelled) return;

      setDisplayName(profileRes.data?.display_name || user?.fullName || "");
      setAvatarPath(profileRes.data?.avatar_path ?? null);
      setOfficerRow(officerRes.data || null);
      setUnits(unitRes.data || []);
      setAssignments(assignmentRes.assignments);
      setAssignmentsUnavailable(assignmentRes.unavailable);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.fullName]);

  const onSaveName = async (event) => {
    event.preventDefault();
    const trimmed = displayName.trim();
    if (!trimmed) {
      toast.error("Enter a name.");
      return;
    }
    setSavingName(true);
    const result = await updateProfileDisplay(user.id, trimmed);
    setSavingName(false);
    if (result.success) {
      toast.success("Your display name was updated.");
      refresh?.();
    } else {
      toast.error(result.error || "Your display name could not be updated.");
    }
  };

  const onAvatarChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    const result = await uploadAvatar(user.id, file);
    setUploading(false);
    if (result.success) {
      setAvatarPath(result.path);
      toast.success("Your photo was updated.");
      refresh?.();
    } else {
      toast.error(result.error || "Your photo could not be uploaded.");
    }
  };

  const avatarUrl = getAvatarUrl(avatarPath);
  const activeAssignments = assignments.filter((a) => !a.released_at);

  // A signed-out state is a fact about the session, not a load that
  // never finished, so it is rendered rather than left spinning.
  if (!user?.id) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PnpPageHeader title="My Profile" />
        <BoundaryNote title="No active session">
          <p>
            You are not signed in, so there is no profile to show. Sign in again to continue.
          </p>
        </BoundaryNote>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl">
        <PnpPageHeader title="Profile" />
        <LoadingBlock label="Loading your profile…" />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PnpPageHeader
        title="My Profile"
        subtitle="Your account details and the PNP information the barangay has recorded for you."
      />

      {/* Identity */}
      <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="relative shrink-0 self-start">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt=""
                width={96}
                height={96}
                className="h-24 w-24 rounded-full object-cover"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex h-24 w-24 items-center justify-center rounded-full bg-secondary text-2xl font-bold text-white"
              >
                {getInitials(displayName || "PNP")}
              </span>
            )}
            <label
              className="absolute -bottom-1 -right-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-line bg-white text-navy shadow-sm transition-colors hover:border-secondary focus-within:outline-2 focus-within:outline-secondary"
              title="Change photo"
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Change photo</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={onAvatarChange}
                disabled={uploading}
                className="sr-only"
              />
            </label>
          </div>

          <form onSubmit={onSaveName} className="min-w-0 flex-1 space-y-3">
            <TextField
              label="Display name"
              hint="Shown to the Captain and OIC on referral actions and notes."
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={80}
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={savingName}
                className="inline-flex min-h-[40px] items-center rounded-xl bg-secondary px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {savingName ? "Saving…" : "Save name"}
              </button>
              {uploading ? (
                <span className="text-[12px] text-muted">Uploading photo…</span>
              ) : null}
            </div>
          </form>
        </div>
      </section>

      {/* PNP details, read-only */}
      <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <h2 className="font-heading text-base font-semibold text-navy">PNP details</h2>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
          Recorded by a barangay administrator. You cannot change these from this page.
        </p>

        {officerRow || units.length > 0 ? (
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <DetailField label="Rank">{officerRow?.rank}</DetailField>
            <DetailField label="Station">{officerRow?.station_name}</DetailField>
            <DetailField label="Personnel number" mono>
              {officerRow?.personnel_number}
            </DetailField>
            <DetailField label="Contact number">{officerRow?.contact_number}</DetailField>
          </dl>
        ) : (
          <div className="mt-5 rounded-xl border border-dashed border-line bg-alt/40 px-4 py-6 text-center">
            <UserRound className="mx-auto h-5 w-5 text-muted" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-navy">No PNP details recorded</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              A barangay administrator has not added your rank, station or unit yet. This does not
              stop you working: a referral becomes visible as soon as the Captain assigns it to you.
            </p>
          </div>
        )}
      </section>

      {/* Assignments */}
      <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <h2 className="font-heading text-base font-semibold text-navy">Your assignments</h2>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
          A referral is visible to you only while an active assignment names your account. Releasing
          an assignment removes your access on the next page load.
        </p>

        {assignmentsUnavailable ? (
          <p className="mt-4 text-sm text-muted">
            Assignment records are not available. Apply the PNP migration files.
          </p>
        ) : activeAssignments.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            You have no active assignments right now, so no referral is visible to you.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {activeAssignments.slice(0, 10).map((assignment) => (
              <li key={assignment.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-[13px] text-navy">
                  Assigned {formatDate(assignment.assigned_at)}
                </span>
                <a
                  href={`/pnp/referrals/${assignment.referral_id}`}
                  className="text-[12px] font-semibold text-secondary hover:text-navy"
                >
                  Open referral
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <BoundaryNote title="What you cannot change here">
        <p>
          Your role, your account status and your unit membership are administrative. A PNP officer
          cannot promote themselves, reactivate a suspended account, or attach themselves to a unit
          &mdash; those tables have no write policy for this role, so the attempt would be refused
          by the database even if it were made. Ask the barangay administrator if one of these is
          wrong.
        </p>
        <p className="mt-2 inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden="true" />
          This is the intended behaviour, not a missing feature.
        </p>
      </BoundaryNote>
    </div>
  );
}
