import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { setLeaveGuard } from "./leaveGuard";

/**
 * Keyboard-first forms, the way counter staff are used to:
 *  - Enter moves to the next field; Enter on the last field saves.
 *  - Ctrl+S saves from anywhere.
 *  - Leaving with unsaved changes needs a second Esc (or F-key), after a warning.
 */
export function useFormKeys(opts: { dirty: boolean; onSave: () => void }) {
  const { dirty, onSave } = opts;
  const [leaveWarning, setLeaveWarning] = useState(false);
  const warnedRef = useRef(false);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  useEffect(() => {
    warnedRef.current = false;
    setLeaveWarning(false);
    if (!dirty) {
      setLeaveGuard(null);
      return;
    }
    setLeaveGuard(() => {
      if (warnedRef.current) return true;
      warnedRef.current = true;
      setLeaveWarning(true);
      return false;
    });
    return () => setLeaveGuard(null);
  }, [dirty]);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.ctrlKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        saveRef.current();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onFormKeyDown = useCallback((e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement;
    if (el.tagName === "TEXTAREA" || el.tagName === "BUTTON") return;
    e.preventDefault();
    const fields = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])"),
    );
    const i = fields.indexOf(el);
    if (i >= 0 && i < fields.length - 1) {
      fields[i + 1].focus();
      if (fields[i + 1] instanceof HTMLInputElement) (fields[i + 1] as HTMLInputElement).select();
    } else saveRef.current();
  }, []);

  return { onFormKeyDown, leaveWarning };
}
