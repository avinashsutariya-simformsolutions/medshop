import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { canLeave } from "./leaveGuard";

/**
 * Global keyboard shortcuts, familiar to users coming from older pharmacy
 * software. Every shortcut is also printed on its button, so nobody has to
 * memorise them.
 */
export const ROUTE_KEYS: Record<string, string> = {
  F2: "/bill",
  F3: "/purchase",
  F6: "/stock",
  F7: "/expiry",
  F8: "/reports",
  F9: "/settings",
};

export const SEARCH_EVENT = "medshop:focus-search";

/** Esc goes one level up: /stock/items/12 → /stock, /suppliers → home. */
export function parentPath(path: string): string | null {
  if (path === "/" || path === "") return null;
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "stock" && parts.length > 1) return "/stock";
  return "/";
}

export function useGlobalShortcuts() {
  const navigate = useNavigate();
  const { pathname, state } = useLocation();
  // Pages like /import remember where the user came from, so Esc returns there.
  const from = (state as { from?: string } | null)?.from;

  useEffect(() => {
    const go = (to: string) => {
      if (to !== pathname && canLeave()) navigate(to);
    };
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      const route = ROUTE_KEYS[e.key];
      if (route) {
        e.preventDefault();
        go(route);
        return;
      }
      if (e.key === "F4" || (e.key === "/" && !isTyping(e.target))) {
        e.preventDefault();
        if (pathname !== "/") {
          if (!canLeave()) return;
          navigate("/");
        }
        // Let the home screen mount first, then focus its search box.
        setTimeout(() => window.dispatchEvent(new Event(SEARCH_EVENT)), 0);
        return;
      }
      if (e.key === "Escape") {
        const up = pathname === "/import" && from ? from : parentPath(pathname);
        if (up) {
          e.preventDefault();
          go(up);
        }
        return;
      }
      // Block browser refresh / find inside the desktop app.
      if (e.key === "F5" || (e.ctrlKey && (e.key === "r" || e.key === "f"))) {
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, pathname, from]);
}

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
