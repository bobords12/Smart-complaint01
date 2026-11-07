import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

export interface ResidentSettingsRow {
  id: string;
  user_id: string;
  theme: string;
  complaint_updates: boolean;
  hearing_reminders: boolean;
  sms_updates: boolean;
  general_notices: boolean;
  reduced_motion: boolean;
  increased_text: boolean;
  created_at: string;
  updated_at: string;
}

export async function getSettings(): Promise<ResidentSettingsRow | null> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  const { data, error } = await supabase
    .from("resident_settings")
    .select("*")
    .eq("user_id", userData.user.id)
    .single();

  if (error) return null;
  return data as ResidentSettingsRow;
}

export async function upsertSettings(settings: {
  theme?: string;
  complaint_updates?: boolean;
  hearing_reminders?: boolean;
  sms_updates?: boolean;
  general_notices?: boolean;
  reduced_motion?: boolean;
  increased_text?: boolean;
}): Promise<{ success: boolean; data?: ResidentSettingsRow; error?: string }> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { success: false, error: "Not authenticated" };

  const { data, error } = await supabase
    .from("resident_settings")
    .upsert(
      { user_id: userData.user.id, ...settings },
      { onConflict: "user_id" }
    )
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "No data returned from save." };
  return { success: true, data: data as ResidentSettingsRow };
}
