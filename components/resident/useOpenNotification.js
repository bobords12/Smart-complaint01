"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useNotifications } from "./NotificationsProvider";
import { resolveNotificationTarget } from "@/lib/residentRoutes";

/**
 * One behaviour for opening a notification, used by the notifications page
 * and the dashboard preview so the two can never disagree.
 *
 * Order matters and is the whole point:
 *   1. only the clicked notification is marked read — never a neighbour;
 *   2. the destination is resolved from the row's related ids, so the
 *      resident lands on the exact complaint or the exact session;
 *   3. a notification with no related record is left alone with an
 *      explanation instead of being pushed somewhere generic.
 *
 * The destination page owns the "that record is gone" case. It resolves the
 * id, checks it belongs to this resident, and says so plainly if it does
 * not — so a stale notification degrades into a sentence, not a crash.
 */
export default function useOpenNotification() {
  const router = useRouter();
  const { markRead } = useNotifications();

  return useCallback(
    async (item) => {
      if (item?.unread) {
        await markRead(item.id);
      }

      const target = resolveNotificationTarget(item);

      if (!target) {
        toast("This notice does not point to a specific case record.", {
          icon: "ℹ️",
        });
        return;
      }

      router.push(target.href);
    },
    [markRead, router]
  );
}
