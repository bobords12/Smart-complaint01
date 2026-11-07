export type ThemePreference = "light" | "dark" | "system";

export interface ResidentSettings {
  theme: ThemePreference;
  notifications: {
    complaintUpdates: boolean;
    hearingReminders: boolean;
    smsUpdates: boolean;
    generalNotices: boolean;
  };
  accessibility: {
    reducedMotion: boolean;
    increasedTextSize: boolean;
  };
}

export const DEFAULT_SETTINGS: ResidentSettings = {
  theme: "light",
  notifications: {
    complaintUpdates: true,
    hearingReminders: true,
    smsUpdates: false,
    generalNotices: true,
  },
  accessibility: {
    reducedMotion: false,
    increasedTextSize: false,
  },
};
