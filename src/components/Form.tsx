// Small building blocks so every form looks and behaves the same.
import type { ComponentProps, ReactNode } from "react";

export const inputCls =
  "h-10 w-full rounded-lg border border-line bg-card px-3 text-base outline-none focus:border-brand aria-[invalid=true]:border-bad disabled:bg-paper disabled:text-ink-soft";

export function Field(props: {
  label: string;
  htmlFor: string;
  required?: boolean;
  requiredLabel?: string;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={props.className}>
      <label htmlFor={props.htmlFor} className="mb-1 block text-sm font-medium text-ink">
        {props.label}
        {props.required && <span className="ml-1 text-bad" aria-label={props.requiredLabel}>*</span>}
      </label>
      {props.children}
      {props.error ? (
        <p className="mt-1 text-sm text-bad" role="alert">
          {props.error}
        </p>
      ) : props.hint ? (
        <p className="mt-1 text-sm text-ink-soft">{props.hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput(props: ComponentProps<"input">) {
  return <input autoComplete="off" spellCheck={false} {...props} className={inputCls + " " + (props.className ?? "")} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={inputCls + " " + (props.className ?? "")} />;
}

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  kind?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  kbd?: string;
}) {
  const k = props.kind ?? "secondary";
  const cls =
    k === "primary"
      ? "bg-brand text-white hover:bg-brand-ink disabled:opacity-50"
      : k === "ghost"
        ? "text-brand hover:bg-brand-soft"
        : "border border-line bg-card text-ink hover:border-brand";
  return (
    <button
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={props.disabled}
      className={`inline-flex h-10 items-center gap-2 rounded-lg px-4 font-medium transition ${cls}`}
    >
      {props.children}
      {props.kbd && (
        <kbd className={"rounded border px-1.5 font-mono text-xs " + (k === "primary" ? "border-white/40" : "border-line text-ink-soft")}>
          {props.kbd}
        </kbd>
      )}
    </button>
  );
}

export function PageHeader(props: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">{props.title}</h1>
        {props.sub && <p className="mt-0.5 text-ink-soft">{props.sub}</p>}
      </div>
      {props.actions && <div className="flex flex-wrap gap-2">{props.actions}</div>}
    </div>
  );
}

export function Banner(props: { tone: "warn" | "bad" | "ok" | "info"; children: ReactNode }) {
  const cls = {
    warn: "border-warn/30 bg-warn-soft text-warn",
    bad: "border-bad/30 bg-bad-soft text-bad",
    ok: "border-ok/30 bg-brand-soft text-ok",
    info: "border-line bg-paper text-ink-soft",
  }[props.tone];
  return (
    <div role={props.tone === "bad" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 ${cls}`}>
      {props.children}
    </div>
  );
}
