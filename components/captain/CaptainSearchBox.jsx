"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useOfficialRoutes } from "@/components/official/OfficialPortalProvider";
import EmptyState from "@/components/shared/EmptyState";

function resolveReference(c) {
  return c.reference_number || c.id;
}

export default function CaptainSearchBox({
  id = "captain-search",
  label = "Search anything",
  placeholder = "Search anything...",
}) {
  const router = useRouter();
  const routes = useOfficialRoutes();
  const containerRef = useRef(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const trimmed = query.trim();
  const canSearch = trimmed.length >= 2;
  const showResults = open && trimmed.length > 0;

  useEffect(() => {
    if (!canSearch) return undefined;

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setSearching(true);
      (async () => {
        try {
          const supabase = createClient();
          const { data, error } = await supabase
            .from("complaints")
            .select("id, reference_number, title, current_status")
            .or(
              `reference_number.ilike.%${trimmed}%,title.ilike.%${trimmed}%`
            )
            .order("submitted_at", { ascending: false })
            .limit(8);
          if (cancelled) return;
          setResults(error ? [] : (data || []));
        } catch {
          if (!cancelled) setResults([]);
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [canSearch, trimmed]);

  const close = () => {
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleSelect = (complaint) => {
    setQuery("");
    close();
    router.push(`${routes.complaints}/${complaint.id}`);
  };

  const handleSearchAll = () => {
    const term = trimmed;
    setQuery("");
    close();
    router.push(
      term
        ? `${routes.complaints}?q=${encodeURIComponent(term)}`
        : routes.complaints
    );
  };

  useEffect(() => {
    if (!showResults) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const items = results;
      const total = items.length + 1;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (index + delta + total) % total);
    };
    window.addEventListener("keydown", onKeyDown);

    const onMouseDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        close();
      }
    };
    document.addEventListener("mousedown", onMouseDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [showResults, results]);

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
          aria-controls="captain-search-results"
          aria-label={label}
          onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            setOpen(true);
            setActiveIndex(-1);
            if (value.trim().length < 2) {
              setResults([]);
              setSearching(false);
            }
          }}
          onFocus={() => setOpen(true)}
          className="h-11 w-full rounded-full border border-line bg-white pl-10 pr-10 text-sm text-mirage outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted/60 focus:border-secondary focus:ring-2 focus:ring-secondary/20"
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
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted transition-colors hover:bg-alt hover:text-navy"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {showResults ? (
        <div
          id="captain-search-results"
          role="listbox"
          aria-label="Captain portal search results"
          className="modal-panel absolute inset-x-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-2xl border border-line bg-white shadow-[0_16px_40px_rgba(11,33,68,0.18)]"
        >
          {searching ? (
            <div className="px-4 py-5 text-center text-[13px] font-medium text-muted">
              Searching complaints…
            </div>
          ) : results.length > 0 ? (
            <>
              <ul
                className="max-h-80 divide-y divide-line/70 overflow-y-auto"
                aria-label="Complaint matches"
              >
                {results.map((complaint, index) => {
                  const active = index === activeIndex;
                  return (
                    <li key={complaint.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          handleSelect(complaint);
                        }}
                        onMouseEnter={() => setActiveIndex(index)}
                        className={`flex w-full min-h-[44px] items-start gap-3 px-4 py-3 text-left transition-colors ${
                          active ? "bg-info-soft" : "bg-white"
                        }`}
                      >
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info-soft">
                          <FileText
                            className="h-4 w-4 text-secondary"
                            aria-hidden="true"
                          />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-mirage">
                            {complaint.title}
                          </span>
                          <span className="mt-0.5 block text-[12px] text-muted">
                            {resolveReference(complaint)}
                            {" · "}
                            {complaint.current_status || "Pending Review"}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="border-t border-line/70">
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    handleSearchAll();
                  }}
                  className={`flex min-h-[44px] w-full items-center gap-2 px-4 py-3 text-left text-[13px] font-semibold transition-colors ${
                    activeIndex === results.length
                      ? "bg-info-soft text-secondary"
                      : "bg-white text-secondary"
                  }`}
                >
                  <Search className="h-4 w-4" aria-hidden="true" />
                  Search all complaints for &ldquo;{trimmed}&rdquo;
                </button>
              </div>
            </>
          ) : (
            <div className="border-t border-line/70">
              <EmptyState
                title="No records found"
                message={
                  canSearch
                    ? `No complaints match "${trimmed}".`
                    : "Type at least 2 characters to search complaints."
                }
                icon={Search}
              />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}