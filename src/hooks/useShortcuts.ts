import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

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

export function useGlobalShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const route = ROUTE_KEYS[e.key];
      if (route) {
        e.preventDefault();
        navigate(route);
        return;
      }
      if (e.key === "F4" || (e.key === "/" && !isTyping(e.target))) {
        e.preventDefault();
        navigate("/");
        // Let the home screen mount first, then focus its search box.
        setTimeout(() => window.dispatchEvent(new Event(SEARCH_EVENT)), 0);
        return;
      }
      if (e.key === "Escape" && !isTyping(e.target)) {
        navigate("/");
      }
      // Block browser refresh / find inside the desktop app.
      if (e.key === "F5" || (e.ctrlKey && (e.key === "r" || e.key === "f"))) {
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
