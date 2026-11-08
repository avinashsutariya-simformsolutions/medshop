// One screen at a time can say "I have unsaved changes".
// Before any shortcut navigates away, it asks here first.
// The first attempt is blocked (the form shows a warning); a second attempt is allowed.

type Guard = () => boolean; // return true to allow leaving

let guard: Guard | null = null;

export function setLeaveGuard(g: Guard | null) {
  guard = g;
}

export function canLeave(): boolean {
  return guard ? guard() : true;
}
