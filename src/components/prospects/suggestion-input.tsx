"use client";

// A text input with a lightweight, premium autocomplete + typo-correction
// dropdown, used by the Discover "Create discovery search" modal and the
// inside-company "Search this company" card. Suggestions come from
// loadDiscoverSuggestions (provider-free): company rows from Sendloom's global
// company identity records, role/location rows from the user's own Discover
// history. This component never calls a provider itself and never bypasses
// backend validation: choosing a suggestion only fills the input.
//
// Features: 200ms debounce, per-type minimum query length, comma-token support
// (a suggestion replaces only the caret's token), keyboard navigation
// (Arrow/Enter/Escape), click-to-select, and click-outside/blur to close. When
// there are no suggestions nothing is shown — never an empty "no results" box.

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type Ref,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";

import {
  loadDiscoverSuggestions,
  type DiscoverSuggestion,
  type DiscoverSuggestionType
} from "@/components/prospects/prospect-graphql";
import { activeToken, replaceActiveToken } from "@/services/prospects/discover-suggestions";
import styles from "@/components/prospects/prospects-dashboard.module.css";

const DEBOUNCE_MS = 200;
const PORTAL_VIEWPORT_MARGIN_PX = 8;
const PORTAL_DROPDOWN_GAP_PX = 5;
const PORTAL_DROPDOWN_MAX_HEIGHT_REM = 13;
const PORTAL_DROPDOWN_MIN_HEIGHT_PX = 48;
// Company matches on a single strong letter (domains are short); roles/locations
// wait for two so a lone character never spams the dropdown.
const DEFAULT_MIN_CHARS: Record<DiscoverSuggestionType, number> = { COMPANY: 1, ROLE: 2, LOCATION: 2 };

export type SuggestionInputProps = {
  type: DiscoverSuggestionType;
  value: string;
  onChange: (value: string) => void;
  /** Inside-company card: prioritize this company's roles/locations. */
  companyId?: string | null;
  /** Job titles / Locations accept a comma-separated list; suggestions apply to the caret's token. */
  multiToken?: boolean;
  /** Fired when a suggestion is chosen (e.g. to capture a company's dedupe hints). */
  onSelectSuggestion?: (suggestion: DiscoverSuggestion) => void;
  minChars?: number;
  id?: string;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  /** Escape an overflow-clipped modal/card while preserving the input anchor. */
  portalToBody?: boolean;
};

function assignRef(ref: Ref<HTMLInputElement> | undefined, node: HTMLInputElement | null) {
  if (!ref) {
    return;
  }
  if (typeof ref === "function") {
    ref(node);
  } else {
    (ref as MutableRefObject<HTMLInputElement | null>).current = node;
  }
}

export function SuggestionInput({
  type,
  value,
  onChange,
  companyId = null,
  multiToken = false,
  onSelectSuggestion,
  minChars,
  id,
  inputRef,
  className,
  placeholder,
  required,
  autoFocus,
  disabled,
  ariaLabel,
  portalToBody = false
}: SuggestionInputProps) {
  const reactId = useId();
  const listId = `${reactId}-suggestions`;
  const effectiveMinChars = minChars ?? DEFAULT_MIN_CHARS[type];

  const [suggestions, setSuggestions] = useState<DiscoverSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [focused, setFocused] = useState(false);

  const internalRef = useRef<HTMLInputElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const caretRef = useRef<number>(value.length);
  // Set right after a selection so the resulting value change does not instantly
  // re-open the dropdown for the value we just filled in.
  const suppressRef = useRef(false);
  const [portalStyle, setPortalStyle] = useState<CSSProperties | null>(null);

  const setInputNode = useCallback(
    (node: HTMLInputElement | null) => {
      internalRef.current = node;
      assignRef(inputRef, node);
    },
    [inputRef]
  );

  // The token the caret sits in (whole value for single-token fields) — what we
  // actually query suggestions for.
  const queryToken = multiToken ? activeToken(value, caretRef.current) : value.trim();

  // Debounced fetch. Only runs while focused; aborts in-flight requests so a
  // fast typist never sees a stale list.
  useEffect(() => {
    if (!focused) {
      return;
    }
    if (suppressRef.current) {
      suppressRef.current = false;
      return;
    }
    if (queryToken.length < effectiveMinChars) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      const results = await loadDiscoverSuggestions({ query: queryToken, type, companyId }, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      setSuggestions(results);
      setOpen(results.length > 0);
      setActiveIndex(-1);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [queryToken, type, companyId, effectiveMinChars, focused]);

  // Click outside the field closes the dropdown (leaves the modal/card open).
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(target) &&
        !listRef.current?.contains(target)
      ) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const applySuggestion = useCallback(
    (suggestion: DiscoverSuggestion) => {
      const node = internalRef.current;
      const caret = node?.selectionStart ?? caretRef.current;
      let nextValue: string;
      let nextCaret: number;
      if (multiToken) {
        const replaced = replaceActiveToken(value, caret, suggestion.value);
        nextValue = replaced.value;
        nextCaret = replaced.caret;
      } else {
        nextValue = suggestion.value;
        nextCaret = suggestion.value.length;
      }
      suppressRef.current = true;
      onChange(nextValue);
      onSelectSuggestion?.(suggestion);
      setOpen(false);
      setActiveIndex(-1);
      setSuggestions([]);
      // Restore focus + caret after React commits the new value.
      requestAnimationFrame(() => {
        const current = internalRef.current;
        if (current) {
          current.focus();
          current.setSelectionRange(nextCaret, nextCaret);
          caretRef.current = nextCaret;
        }
      });
    },
    [multiToken, onChange, onSelectSuggestion, value]
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (!open || suggestions.length === 0) {
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % suggestions.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
      } else if (event.key === "Enter") {
        // Only intercept Enter when a row is highlighted — otherwise the form
        // submits normally (a suggestion never submits by accident).
        if (activeIndex >= 0 && activeIndex < suggestions.length) {
          event.preventDefault();
          applySuggestion(suggestions[activeIndex]);
        }
      } else if (event.key === "Escape") {
        // Close ONLY the dropdown; stopImmediatePropagation keeps the modal/card
        // (which also listens for Escape) open.
        event.preventDefault();
        event.nativeEvent.stopImmediatePropagation();
        setOpen(false);
        setActiveIndex(-1);
      }
    },
    [activeIndex, applySuggestion, open, suggestions]
  );

  const showDropdown = open && focused && suggestions.length > 0;

  // The same-company modal scrolls internally, so its absolutely positioned
  // descendants are clipped at the card edge. For that modal only, anchor the
  // list to the input in viewport coordinates and render it through <body>.
  // Capture-phase scroll tracking also catches the modal's own scroll container.
  useEffect(() => {
    if (!showDropdown || !portalToBody) {
      setPortalStyle(null);
      return;
    }

    let frame = 0;
    const updatePosition = () => {
      const input = internalRef.current;
      if (!input) {
        return;
      }
      const rect = input.getBoundingClientRect();
      const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
      const availableHeight =
        window.innerHeight - rect.bottom - PORTAL_DROPDOWN_GAP_PX - PORTAL_VIEWPORT_MARGIN_PX;
      const maxHeight = Math.max(
        PORTAL_DROPDOWN_MIN_HEIGHT_PX,
        Math.min(PORTAL_DROPDOWN_MAX_HEIGHT_REM * rootFontSize, availableHeight)
      );
      const width = Math.min(rect.width, window.innerWidth - PORTAL_VIEWPORT_MARGIN_PX * 2);
      const left = Math.max(
        PORTAL_VIEWPORT_MARGIN_PX,
        Math.min(rect.left, window.innerWidth - width - PORTAL_VIEWPORT_MARGIN_PX)
      );
      const nextStyle = {
        top: rect.bottom + PORTAL_DROPDOWN_GAP_PX,
        left,
        width,
        maxHeight
      };
      setPortalStyle((current) =>
        current?.top === nextStyle.top &&
        current.left === nextStyle.left &&
        current.width === nextStyle.width &&
        current.maxHeight === nextStyle.maxHeight
          ? current
          : nextStyle
      );
    };
    const schedulePositionUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updatePosition);
    };

    updatePosition();
    window.addEventListener("resize", schedulePositionUpdate);
    window.addEventListener("scroll", schedulePositionUpdate, true);
    const resizeObserver = new ResizeObserver(schedulePositionUpdate);
    if (internalRef.current) {
      resizeObserver.observe(internalRef.current);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedulePositionUpdate);
      window.removeEventListener("scroll", schedulePositionUpdate, true);
      resizeObserver.disconnect();
    };
  }, [portalToBody, showDropdown]);

  const suggestionList = showDropdown ? (
    <ul
      ref={listRef}
      id={listId}
      role="listbox"
      className={`${styles.suggestionList} ${portalToBody ? styles.suggestionListPortal : ""}`}
      style={portalToBody && portalStyle ? portalStyle : undefined}
    >
      {suggestions.map((suggestion, index) => {
        const isCorrection = suggestion.kind === "CORRECTION";
        const rowClass = [
          styles.suggestionItem,
          index === activeIndex ? styles.suggestionItemActive : "",
          isCorrection ? styles.suggestionCorrection : ""
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <li key={`${suggestion.kind}-${suggestion.value}-${index}`} role="option" aria-selected={index === activeIndex}>
            <button
              type="button"
              id={`${listId}-${index}`}
              className={rowClass}
              // Keep focus on the input so the click lands before blur closes us.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => applySuggestion(suggestion)}
            >
              {isCorrection ? (
                <span className={styles.suggestionCorrectionText}>
                  <Sparkles aria-hidden="true" className={styles.suggestionCorrectionIcon} />
                  <span>
                    Did you mean <strong>{suggestion.value}</strong>?
                  </span>
                </span>
              ) : (
                // Clean, minimal rows: the value, plus a company's domain as
                // muted subtext. No usage counts, no "previous search" badge.
                <span className={styles.suggestionMain}>
                  <span className={styles.suggestionValue}>{suggestion.value}</span>
                  {suggestion.detail && <span className={styles.suggestionDetail}>{suggestion.detail}</span>}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  ) : null;

  return (
    <div ref={wrapperRef} className={styles.suggestionField}>
      <input
        ref={setInputNode}
        id={id}
        className={className ?? styles.input}
        value={value}
        onChange={(event) => {
          caretRef.current = event.target.selectionStart ?? event.target.value.length;
          onChange(event.target.value);
        }}
        onKeyUp={(event) => {
          caretRef.current = event.currentTarget.selectionStart ?? caretRef.current;
        }}
        onClick={(event) => {
          caretRef.current = event.currentTarget.selectionStart ?? caretRef.current;
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setOpen(false);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={ariaLabel}
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={showDropdown ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={showDropdown && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
      />
      {suggestionList && portalToBody
        ? portalStyle && typeof document !== "undefined"
          ? createPortal(suggestionList, document.body)
          : null
        : suggestionList}
    </div>
  );
}
