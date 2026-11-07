"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, FileText, Search, X } from "lucide-react";
import { searchResidentData } from "@/lib/residentSearch";
import { RESIDENT_ROUTES } from "@/lib/constants";
import EmptyState from "@/components/shared/EmptyState";

export default function SearchBox({ id = "resident-search", label = "Search", placeholder = "Search complaints" }) {
  const router = useRouter();
  const containerRef = useRef(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const trimmed = query.trim();
  const { complaints, notifications } = useMemo(
    () => searchResidentData(trimmed),
    [trimmed]
  );

  const results = useMemo(() => {
    const list = [];
    complaints.forEach((item) =>
      list.push({
        key: `c-${item.caseNo}`,
        kind: "complaint",
        title: item.title,
        sub: `${item.caseNo} · ${item.category}`,
        go: () =>
          router.push(`${RESIDENT_ROUTES.complaints}?case=${item.caseNo}`),
      })
    );
    notifications.forEach((item) =>
      list.push({
        key: `n-${item.id}`,
        kind: "notification",
        title: item.message,
        sub: "Notification",
        go: () => router.push(RESIDENT_ROUTES.notifications),
      })
    );
    return list;
  }, [complaints, notifications, router]);

  const showResults = open && trimmed.length > 0;

  const close = () => setOpen(false);

  const handleSelect = (result) => {
    setQuery("");
    setOpen(false);
    setActiveIndex(-1);
    result.go();
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const length = results.length;
      if (length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (index + delta + length) % length);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, results.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (event) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        close();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative w-full">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted/70"
          aria-hidden="true"
        />
        <input
          id={id}
          type="search"
          role="combobox"
          value={query}
          autoComplete="off"
          placeholder={placeholder}
          aria-expanded={showResults}
          aria-controls="resident-search-results"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          className="h-11 w-full rounded-full border border-line bg-white dark:bg-canvas pl-10 pr-10 text-sm text-mirage outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted/60 focus:border-secondary focus:ring-2 focus:ring-secondary/20"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setOpen(false);
              setActiveIndex(-1);
            }}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted transition-colors hover:bg-alt hover:text-navy dark:hover:text-secondary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {showResults ? (
        <div
          id="resident-search-results"
          role="listbox"
          aria-label="Search results"
          className="modal-panel absolute inset-x-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-2xl border border-line bg-white dark:bg-alt shadow-[0_16px_40px_rgba(11,33,68,0.18)] dark:shadow-[0_16px_40px_rgba(0,0,0,0.4)]"
        >
          {results.length > 0 ? (
            <ul className="max-h-80 divide-y divide-line/70 overflow-y-auto">
              {results.map((result, index) => {
                const active = index === activeIndex;
                const Icon = result.kind === "complaint" ? FileText : Bell;
                return (
                  <li key={result.key}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        handleSelect(result);
                      }}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={`flex w-full min-h-[44px] items-start gap-3 px-4 py-3 text-left transition-colors ${
                        active ? "bg-info-soft" : "bg-white dark:bg-alt"
                      }`}
                    >
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info-soft">
                        <Icon className="h-4 w-4 text-secondary" aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-mirage">
                          {result.title}
                        </span>
                        <span className="mt-0.5 block text-[12px] text-muted">
                          {result.sub}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="border-t border-line/70">
              <EmptyState
                title="No results"
                message={`No match for "${trimmed}".`}
                icon={Search}
              />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}