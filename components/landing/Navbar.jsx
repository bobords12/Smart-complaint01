"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Menu, LogIn, UserPlus, X } from "lucide-react";
import { NAV_LINKS, ROUTES, SITE } from "@/lib/constants";
import { useAuthModal } from "@/context/AuthModalContext";

function smoothScrollTo(targetId) {
  const reduced =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(targetId)?.scrollIntoView({
    behavior: reduced ? "auto" : "smooth",
    block: "start",
  });
}

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { openLogin, openRegister } = useAuthModal();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const handleNavClick = (event, href) => {
    if (href.startsWith("#")) {
      event.preventDefault();
      setMenuOpen(false);
      smoothScrollTo(href.slice(1));
    }
  };

  const handleMobileLogin = () => {
    setMenuOpen(false);
    openLogin();
  };

  const handleMobileRegister = () => {
    setMenuOpen(false);
    openRegister();
  };

  return (
    <header
      className={`sticky top-0 z-50 w-full bg-white/95 backdrop-blur dark:bg-alt/95 transition-shadow duration-300 ${
        scrolled ? "shadow-[0_2px_16px_rgba(14,47,92,0.12)]" : "shadow-none"
      }`}
    >
      <div className="container-scbms flex h-[72px] items-center justify-between gap-4">
        {/* Brand */}
        <Link
          href={ROUTES.home}
          className="flex min-w-0 items-center gap-2.5 rounded-md"
          aria-label={`${SITE.shortName} — ${SITE.name} home`}
        >
          <Image
            src="/Abunoi.jpg"
            alt="Official seal of Barangay Abuno"
            width={48}
            height={48}
            className="h-12 w-12 shrink-0 rounded-full object-contain"
          />
          <span className="hidden min-w-0 font-heading text-[17px] font-bold leading-tight text-navy dark:text-secondary md:block">
            {SITE.name}
          </span>
        </Link>

        {/* Desktop nav */}
        <nav
          aria-label="Primary"
          className="hidden items-center gap-10 lg:flex"
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              onClick={(event) => handleNavClick(event, link.href)}
              className="rounded px-0.5 py-1 text-sm font-medium text-muted transition-colors hover:text-navy dark:hover:text-secondary focus-visible:text-navy dark:focus-visible:text-secondary"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Desktop actions */}
        <div className="hidden items-center gap-[18px] lg:flex">
          <button
            type="button"
            onClick={openLogin}
            className="rounded text-sm font-semibold text-mirage transition-colors hover:text-navy dark:hover:text-secondary"
          >
            Login
          </button>
          <button
            type="button"
            onClick={openRegister}
            className="rounded-full bg-navy px-6 py-[13px] text-sm font-semibold text-white transition-colors hover:bg-secondary"
          >
            Register
          </button>
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-navy dark:text-secondary transition-colors hover:bg-alt focus-visible:outline-secondary lg:hidden"
        >
          {menuOpen ? (
            <X className="h-6 w-6" aria-hidden="true" />
          ) : (
            <Menu className="h-6 w-6" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Mobile menu */}
      <div
        id="mobile-menu"
        aria-hidden={!menuOpen}
        className={`lg:hidden ${
          menuOpen
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-2 opacity-0"
        } absolute inset-x-0 top-full border-b border-line bg-white dark:bg-alt shadow-[0_16px_32px_rgba(14,47,92,0.12)] transition-all duration-300`}
      >
        <nav aria-label="Mobile" className="container-scbms py-6">
          <ul className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <li key={link.label}>
                <a
                  href={link.href}
                  onClick={(event) => handleNavClick(event, link.href)}
                  tabIndex={menuOpen ? 0 : -1}
                  className="block rounded-lg px-3 py-3 text-base font-medium text-muted transition-colors hover:bg-alt hover:text-navy dark:hover:text-secondary"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex flex-col gap-3 border-t border-line pt-6">
            <button
              type="button"
              onClick={handleMobileLogin}
              tabIndex={menuOpen ? 0 : -1}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-navy px-6 py-3 text-sm font-semibold text-navy dark:border-secondary dark:text-secondary transition-colors hover:bg-navy hover:text-white dark:hover:bg-secondary"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Login
            </button>
            <button
              type="button"
              onClick={handleMobileRegister}
              tabIndex={menuOpen ? 0 : -1}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-navy px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-secondary"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Register
            </button>
          </div>
        </nav>
      </div>
    </header>
  );
}
