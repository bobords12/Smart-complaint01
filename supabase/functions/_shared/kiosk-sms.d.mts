/**
 * Type declarations for the shared kiosk SMS module.
 *
 * The implementation is plain ESM JavaScript so that the Node test
 * script and the Deno edge runtime can both execute the very same
 * file. These declarations exist only so that the TypeScript edge
 * function gets real types instead of `any`.
 */

export const KIOSK_SMS_NOTIFICATION_TYPE: string;
export const PHILSMS_DEFAULT_BASE_URL: string;
export const PHILSMS_SEND_PATH: string;
export const PHILSMS_SENDER_ID_MAX_LENGTH: number;
export const KIOSK_INITIAL_STATUS: string;

export function isKioskSmsEnabled(env?: Record<string, unknown>): boolean;
export function isKioskSmsDispatchEnabled(env?: Record<string, unknown>): boolean;

export function normalizePhMobile(value: unknown): string | null;
export function toProviderRecipient(
  mobile: unknown,
  options?: { format?: "63" | "+63" }
): string | null;
export function buildKioskConfirmationMessage(params: {
  referenceNumber?: unknown;
  status?: unknown;
}): string;
export function countSmsSegments(text: unknown): {
  segments: number;
  encoding: "gsm7" | "ucs2";
  length: number;
};
export function buildPhilsmsSendPayload(params: {
  recipient?: unknown;
  senderId?: unknown;
  message?: unknown;
}): { recipient: string; sender_id: string; type: string; message: string };
export function philsmsSendUrl(baseUrl?: string): string;
export function extractProviderMessageId(data: unknown): string | null;
export function classifyPhilsmsOutcome(outcome: {
  httpStatus?: number;
  body?: unknown;
  transportError?: string;
}): {
  kind: "accepted" | "retryable" | "uncertain" | "permanent";
  code: string;
  message: string;
  providerMessageId: string | null;
  providerStatus: string | null;
};
export function createPhilsmsSender(options: {
  apiToken?: string;
  senderId?: string;
  baseUrl?: string;
  recipientFormat?: "63" | "+63";
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): (input: { recipient?: unknown; message?: unknown }) => Promise<{
  ok: boolean;
  providerMessageId?: string | null;
  providerStatus?: string | null;
  kind?: "retryable" | "uncertain" | "permanent";
  code?: string;
  message?: string;
}>;
