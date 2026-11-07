/**
 * Type declarations for the shared kiosk SMS worker.
 */

import type { SMS_JOB_STATUS } from "./kiosk-sms-worker.mjs";

export declare const SMS_JOB_STATUS: typeof SMS_JOB_STATUS;
export declare const DEFAULT_BACKOFF_MS: number[];
export declare const DEFAULT_STALE_MS: number;
export declare const DEFAULT_MAX_ATTEMPTS: number;

export interface SmsJobRow {
  id: string;
  complaint_id: string;
  notification_type: string;
  recipient?: string | null;
  reference_number?: string | null;
  recipient_format?: string | null;
  status: string;
  attempts?: number | null;
  next_attempt_at?: string | null;
  locked_at?: string | null;
  provider_message_id?: string | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
  message?: string | null;
  created_at?: string | null;
  sent_at?: string | null;
  delivered_at?: string | null;
}

export interface KioskSmsDbAdapter {
  listCandidates(args: {
    now: string;
    limit: number;
  }): Promise<SmsJobRow[]>;
  claim(
    candidate: SmsJobRow,
    args: { now: string; staleBefore: string }
  ): Promise<SmsJobRow | null>;
  getComplaint(complaintId: string): Promise<{
    id: string;
    reference_number: string | null;
    current_status: string | null;
    mobile_number: string | null;
  } | null>;
  reapStale(args: { now: string; staleBefore: string }): Promise<number>;
  markSent(
    job: SmsJobRow,
    details: {
      providerMessageId: string | null;
      providerStatus: string | null;
      message: string;
      sentAt: string;
    }
  ): Promise<void>;
  markRetry(
    job: SmsJobRow,
    details: { code: string; message: string; nextAttemptAt: string }
  ): Promise<void>;
  markFailed(job: SmsJobRow, details: { code: string; message: string }): Promise<void>;
  markUncertain(job: SmsJobRow, details: { code: string; message: string }): Promise<void>;
  markSkipped(job: SmsJobRow, details: { code: string; message: string }): Promise<void>;
}

export declare function runKioskSmsWorker(options: {
  db: KioskSmsDbAdapter;
  send: (input: {
    recipient: string | null;
    message: string;
    referenceNumber: string;
  }) => Promise<{
    ok: boolean;
    providerMessageId?: string | null;
    providerStatus?: string | null;
    kind?: "retryable" | "uncertain" | "permanent";
    code?: string;
    message?: string;
  }>;
  limit?: number;
  maxAttempts?: number;
  staleMs?: number;
  backoffMs?: number[];
  now?: () => number;
  dryRun?: boolean;
  logger?: { log?: (...args: unknown[]) => void };
}): Promise<{
  processed: number;
  sent: number;
  failed: number;
  uncertain: number;
  skipped: number;
  retried: number;
  results: {
    id: string;
    reference: string | null;
    outcome: string;
    code: string;
    message?: string;
    providerMessageId?: string | null;
    nextAttemptAt?: string;
  }[];
}>;
