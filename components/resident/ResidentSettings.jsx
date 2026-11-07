"use client";

import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import {
  Bell,
  Eye,
  ShieldCheck,
} from "lucide-react";
import PasswordSection from "./PasswordSection";
import {
  getSettings,
  upsertSettings,
} from "@/repositories/settingsRepository";
import { DEFAULT_SETTINGS } from "@/types/settings";

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

function mapDbToSettings(row) {
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    notifications: {
      complaintUpdates: row.complaint_updates ?? true,
      hearingReminders: row.hearing_reminders ?? true,
      smsUpdates: row.sms_updates ?? false,
      generalNotices: row.general_notices ?? true,
    },
    accessibility: {
      reducedMotion: row.reduced_motion ?? false,
      increasedTextSize: row.increased_text ?? false,
    },
  };
}

function mapSettingsToDb(settings) {
  return {
    complaint_updates: settings.notifications.complaintUpdates,
    hearing_reminders: settings.notifications.hearingReminders,
    sms_updates: settings.notifications.smsUpdates,
    general_notices: settings.notifications.generalNotices,
    reduced_motion: settings.accessibility.reducedMotion,
    increased_text: settings.accessibility.increasedTextSize,
  };
}

export default function ResidentSettings() {
  const [notifications, setNotifications] = useState({
    complaintUpdates: DEFAULT_SETTINGS.notifications.complaintUpdates,
    hearingReminders: DEFAULT_SETTINGS.notifications.hearingReminders,
    smsUpdates: DEFAULT_SETTINGS.notifications.smsUpdates,
    generalNotices: DEFAULT_SETTINGS.notifications.generalNotices,
  });
  const [accessibility, setAccessibility] = useState({
    reducedMotion: DEFAULT_SETTINGS.accessibility.reducedMotion,
    increasedTextSize: DEFAULT_SETTINGS.accessibility.increasedTextSize,
  });
  const [originalNotifications, setOriginalNotifications] = useState(null);
  const [originalAccessibility, setOriginalAccessibility] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const row = await getSettings();
      if (!cancelled) {
        const mapped = mapDbToSettings(row);
        setNotifications(mapped.notifications);
        setOriginalNotifications(mapped.notifications);
        setAccessibility(mapped.accessibility);
        setOriginalAccessibility(mapped.accessibility);
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const updateNotification = useCallback((key, value) => {
    setNotifications((prev) => ({ ...prev, [key]: value }));
  }, []);

  const updateAccessibility = useCallback((key, value) => {
    setAccessibility((prev) => ({ ...prev, [key]: value }));
  }, []);

  const hasNotifChanges = JSON.stringify(notifications) !== JSON.stringify(originalNotifications);
  const hasA11yChanges = JSON.stringify(accessibility) !== JSON.stringify(originalAccessibility);
  const hasChanges = hasNotifChanges || hasA11yChanges;

  const handleSave = useCallback(async () => {
    setSaving(true);
    const toastId = toast.loading("Saving preferences...");
    try {
      const dbUpdates = mapSettingsToDb({
        notifications,
        accessibility,
      });
      const result = await upsertSettings(dbUpdates);
      if (result.success) {
        setOriginalNotifications({ ...notifications });
        setOriginalAccessibility({ ...accessibility });
        toast.success("Preferences saved.", { id: toastId });
      } else {
        toast.error(result.error || "Preferences could not be saved.", { id: toastId });
      }
    } catch {
      toast.error("Preferences could not be saved.", { id: toastId });
    } finally {
      setSaving(false);
    }
  }, [notifications, accessibility]);

  if (loading) {
    return (
      <section aria-labelledby="settings-title" className="mx-auto max-w-[800px]">
        <header>
          <h1 id="settings-title" className="font-heading text-2xl font-semibold tracking-tight text-navy sm:text-3xl">
            Settings
          </h1>
          <p className="mt-1 text-sm text-muted">Loading preferences...</p>
        </header>
      </section>
    );
  }

  return (
    <section aria-labelledby="settings-title" className="mx-auto max-w-[800px]">
      <header>
        <h1
          id="settings-title"
          className="font-heading text-2xl font-semibold tracking-tight text-navy sm:text-3xl"
        >
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted">
          Manage your preferences.
        </p>
      </header>

      <div className="mt-6 space-y-6">
        {/* Notification Preferences */}
        <SectionCard icon={Bell} title="Notifications">
          <div className="mt-4 space-y-4">
            <Toggle
              id="notif-complaint"
              checked={notifications.complaintUpdates}
              onChange={(v) => updateNotification("complaintUpdates", v)}
              label="Complaint updates"
            />
            <Toggle
              id="notif-hearing"
              checked={notifications.hearingReminders}
              onChange={(v) => updateNotification("hearingReminders", v)}
              label="Hearing reminders"
            />
            <Toggle
              id="notif-sms"
              checked={notifications.smsUpdates}
              onChange={(v) => updateNotification("smsUpdates", v)}
              disabled
              label="SMS updates"
            />
            <p className="text-[12px] text-muted -mt-2 ml-14">
              Available after account integration.
            </p>
            <Toggle
              id="notif-general"
              checked={notifications.generalNotices}
              onChange={(v) => updateNotification("generalNotices", v)}
              label="Barangay notices"
            />
          </div>
        </SectionCard>

        {/* Password */}
        <PasswordSection />

        {/* Privacy and Security */}
        <SectionCard icon={ShieldCheck} title="Privacy & Security">
          <div className="space-y-4">
            <div className="border-t border-line pt-4">
              <p className="text-sm font-semibold text-mirage">Sessions</p>
              <p className="mt-1 text-[13px] text-muted">
                Signed in on this device.
              </p>
            </div>

            <div className="border-t border-line pt-4 space-y-2">
              <button
                type="button"
                onClick={() => toast.info("Privacy notice available after deployment.")}
                className="block text-[13px] font-semibold text-secondary underline underline-offset-4 transition-colors hover:text-navy"
              >
                Privacy Notice
              </button>
              <button
                type="button"
                onClick={() => toast.info("Terms of service available after deployment.")}
                className="block text-[13px] font-semibold text-secondary underline underline-offset-4 transition-colors hover:text-navy"
              >
                Terms of Service
              </button>
            </div>
          </div>
        </SectionCard>

        {/* Accessibility */}
        <SectionCard icon={Eye} title="Accessibility">
          <div className="mt-4 space-y-4">
            <Toggle
              id="a11y-motion"
              checked={accessibility.reducedMotion}
              onChange={(v) => updateAccessibility("reducedMotion", v)}
              label="Reduced motion"
            />
            <Toggle
              id="a11y-text"
              checked={accessibility.increasedTextSize}
              onChange={(v) => updateAccessibility("increasedTextSize", v)}
              label="Larger text"
            />
          </div>
        </SectionCard>

        {/* Save button */}
        <div className="flex justify-end pb-8">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-navy px-8 text-sm font-semibold text-white transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-secondary"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </section>
  );
}
