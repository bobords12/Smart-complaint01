"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, LogOut, Settings, UserRound } from "lucide-react";
import { useOfficialRoutes } from "@/components/official/OfficialPortalProvider";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { getAvatarUrl, getOfficialIdentity } from "@/repositories/profileRepository";
import { getRoleProfileDisplay } from "@/lib/roleProfileDisplay";

const MENU_ITEMS = [
  { key: "profile", label: "View Profile" },
  { key: "settings", label: "Account Settings" },
  { key: "logout", label: "Logout" },
];

export default function CaptainProfileMenu({ onLogout }) {
  const { user } = useAuth();
  const routes = useOfficialRoutes();
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [avatar, setAvatar] = useState(null);
  const menuId = "captain-profile-menu";

  const profile = getRoleProfileDisplay(user?.role);
  const { displayName, roleLabel, initials } = profile
    ? { displayName: profile.primary, roleLabel: profile.secondary, initials: profile.initials }
    : getOfficialIdentity(user);
  const avatarUrl = !profile && avatar?.userId === user?.id ? avatar.url : null;

  useEffect(() => {
    if (!user?.id || user.role !== "captain") return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from("profiles")
          .select("avatar_path")
          .eq("id", user.id)
          .single();
        if (!cancelled && data?.avatar_path) {
          setAvatar({ userId: user.id, url: getAvatarUrl(data.avatar_path) });
        }
      } catch {
        // ignore — will show initials fallback
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      setActiveIndex((index) => {
        const length = MENU_ITEMS.length;
        if (index === -1) return 0;
        return (index + (event.key === "ArrowDown" ? 1 : -1) + length) % length;
      });
    };
    window.addEventListener("keydown", onKeyDown);

    const onMouseDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open]);

  const handleItem = (key) => {
    setOpen(false);
    setActiveIndex(-1);
    if (key === "profile") return;
    if (key === "settings") return;
    if (key === "logout") onLogout();
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        className="flex min-h-[44px] items-center gap-2.5 rounded-full border border-line bg-white dark:bg-alt pl-2 pr-3 transition-colors hover:border-secondary/50 hover:bg-alt/60 focus-visible:outline-2 focus-visible:outline-secondary"
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            aria-hidden="true"
            className="h-9 w-9 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-[13px] font-bold text-jordy"
          >
            {initials}
          </span>
        )}
        <span className="hidden text-left sm:block">
          <span className="block max-w-[140px] truncate text-[13px] font-semibold leading-tight text-mirage">
            {displayName}
          </span>
          <span className="block text-[11px] font-medium text-muted">
            {roleLabel}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Officials profile menu"
          className="pop-menu absolute right-0 top-[calc(100%+8px)] z-50 w-56 overflow-hidden rounded-2xl border border-line bg-white dark:bg-alt shadow-[0_16px_40px_rgba(11,33,68,0.18)] dark:shadow-[0_16px_40px_rgba(0,0,0,0.4)]"
        >
          <div className="border-b border-line bg-canvas px-4 py-3">
            <p className="text-sm font-semibold text-mirage">
              {displayName}
            </p>
            <p className="text-[12px] text-muted">{roleLabel}</p>
          </div>
          <ul className="py-1.5">
            {MENU_ITEMS.map((item, index) => {
              const active = index === activeIndex;
              const isLink = item.key === "profile" || item.key === "settings";
              const href = item.key === "profile" ? routes.dashboard : routes.settings;
              const Icon =
                item.key === "profile"
                  ? UserRound
                  : item.key === "settings"
                  ? Settings
                  : LogOut;
              const classes = `flex min-h-[44px] w-full items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors ${
                active ? "bg-info-soft" : ""
              } ${
                item.key === "logout"
                  ? "text-critical hover:bg-critical-soft"
                  : active
                  ? "text-navy dark:text-secondary"
                  : "text-mirage hover:bg-alt/70"
              }`;
              return (
                <li key={item.key}>
                  {isLink ? (
                    <Link
                      href={href}
                      role="menuitem"
                      onClick={() => setOpen(false)}
                      className={classes}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      {item.label}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => handleItem(item.key)}
                      className={classes}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      {item.label}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
