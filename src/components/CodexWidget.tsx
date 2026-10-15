import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUpRight, CornerDownRight, GripVertical, Minus, RefreshCw, X } from "lucide-react";
import { useCodexMeter } from "../hooks/useCodexMeter";
import { formatCountdown, formatLocalReset } from "../lib/rateLimits";
import { freshness } from "../lib/time";
import type { RateLimitBucket } from "../types/codex";
import "./codex-widget.css";

function quotaTone(bucket?: RateLimitBucket) {
  if (!bucket) return "normal";
  return bucket.remainingPercent <= 20 ? "danger" : bucket.remainingPercent <= 35 ? "warning" : "normal";
}

function QuotaRow({ label, bucket, now, stale }: {
  label: string; bucket?: RateLimitBucket; now: number; stale: boolean;
}) {
  const remaining = bucket ? Math.round(bucket.remainingPercent) : undefined;
  return (
    <div className={`widget-quota quota-${quotaTone(bucket)}`}>
      <span className="widget-window">{label}<small>limit</small></span>
      <strong className="widget-percent">{remaining === undefined ? "—" : `${stale ? "~" : ""}${remaining}%`}<small>remaining</small></strong>
      <span className="widget-reset">
        <span>{bucket ? formatCountdown(bucket.resetsAt, now) : "Quota unavailable"}</span>
        <small>{bucket?.resetsAt ? formatLocalReset(bucket.resetsAt, new Date(now)) : "Reset time unavailable"}</small>
      </span>
      {bucket ? <span className="widget-quota-track" role="meter"
        aria-label={`${label} quota remaining`} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={bucket.remainingPercent}
        aria-valuetext={`${remaining}% remaining${stale ? ", last known reading" : ""}`}>
        <i style={{ width: `${bucket.remainingPercent}%` }} />
      </span> : <span className="widget-quota-track" aria-hidden="true" />}
    </div>
  );
}

export function CodexWidget() {
  const { state, buckets, refresh, refreshing } = useCodexMeter({ observeHistory: false });
  const [now, setNow] = useState(Date.now());
  const [expanded, setExpanded] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const expandTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragging = useRef(false);
  const expandedRef = useRef(false);
  const changeExpanded = (next: boolean) => {
    clearTimeout(collapseTimer.current);
    clearTimeout(expandTimer.current);
    if (expandedRef.current === next) return;
    expandedRef.current = next;
    setExpanded(next);
    if ("__TAURI_INTERNALS__" in window) {
      void invoke("set_widget_expanded", { expanded: next }).catch(() => undefined);
    }
  };
  useEffect(() => () => {
    clearTimeout(collapseTimer.current);
    clearTimeout(expandTimer.current);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Prefer the subscription windows over additional model-specific quotas.
  const subscription = buckets.filter((bucket) => bucket.limitId === "codex");
  const candidates = subscription.length ? subscription : buckets;
  const fiveHour = candidates.find((bucket) => bucket.windowDurationMins === 300);
  const weekly = candidates.find((bucket) => bucket.windowDurationMins === 10_080);
  const age = freshness(state.updatedAt, now);
  const stale = state.connection !== "connected" || age?.stale === true;
  const status = state.connection === "connected"
    ? age?.stale ? "Stale reading" : "Live quota"
    : state.connection === "not_authenticated" ? "Sign in to Codex"
    : state.connection === "cli_not_found" ? "Codex CLI missing"
    : state.connection === "starting" ? "Connecting…" : "Reconnecting…";

  const openDashboard = () => {
    if ("__TAURI_INTERNALS__" in window) void invoke("show_dashboard");
  };

  return (
    <main className={`codex-widget${expanded ? "" : " widget-collapsed"}`} aria-label="Codex quota widget"
      onMouseEnter={() => {
        clearTimeout(collapseTimer.current);
        clearTimeout(expandTimer.current);
        if (!expandedRef.current) expandTimer.current = setTimeout(() => changeExpanded(true), 250);
      }}
      onMouseLeave={(event) => {
        clearTimeout(expandTimer.current);
        if (dragging.current || (event.buttons & 1) !== 0) return;
        collapseTimer.current = setTimeout(() => changeExpanded(false), 220);
      }}
      onFocusCapture={() => changeExpanded(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) changeExpanded(false);
      }}>
      {!expanded ? <>
        <button className="widget-compact-brand" title={`${status} · Open UsageBar dashboard`} onClick={openDashboard}>
          <span className={`widget-dot${stale ? " widget-dot-stale" : ""}`} />Codex
        </button>
        <div className="widget-compact-quotas">
          {([["5h", fiveHour], ["7d", weekly]] as const).map(([label, bucket]) => (
            <div className={`widget-compact-row quota-${quotaTone(bucket)}`} key={label} title={bucket?.resetsAt ? formatLocalReset(bucket.resetsAt, new Date(now)) : status}>
              <span>{label}</span>
              <strong>{bucket ? `${stale ? "~" : ""}${Math.round(bucket.remainingPercent)}%` : "—"}</strong>
              <time>{bucket ? formatCountdown(bucket.resetsAt, now).replace("Resets in ", "").replace("Reset time not reported", "—") : "—"}</time>
              {bucket && <span className="widget-chip-track" role="meter"
                aria-label={label === "5h" ? "5-hour quota remaining" : "Weekly quota remaining"}
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={bucket.remainingPercent}
                aria-valuetext={`${Math.round(bucket.remainingPercent)}% remaining${stale ? ", last known reading" : ""}`}>
                <i style={{ width: `${bucket.remainingPercent}%` }} />
              </span>}
            </div>
          ))}
        </div>
      </> : <>
      <header className="widget-header">
        <span className="widget-drag" title="Drag to move meter" aria-label="Drag to move meter" onMouseDown={(event) => {
          if (event.button !== 0 || !("__TAURI_INTERNALS__" in window)) return;
          clearTimeout(collapseTimer.current);
          dragging.current = true;
          void invoke("drag_codex_widget").finally(() => { dragging.current = false; }).catch(() => undefined);
        }}><GripVertical size={13} aria-hidden="true" /></span>
        <button className="widget-dashboard" title="Open UsageBar dashboard" onClick={openDashboard}>
          <span className={`widget-dot${stale ? " widget-dot-stale" : ""}`} />
          <strong>Codex</strong><ArrowUpRight size={13} aria-hidden="true" />
        </button>
        <span className={`widget-status${stale ? " widget-status-stale" : ""}`} title={age?.label}>{status}</span>
        <span className="widget-actions">
          <button className={`widget-refresh${refreshing ? " widget-refreshing" : ""}`} aria-label="Refresh Codex quota" disabled={refreshing} onClick={() => void refresh()}>
            <RefreshCw size={12} aria-hidden="true" />
          </button>
          <button className="widget-refresh" aria-label="Restore meter to bottom-right" title="Restore to bottom-right" onClick={() => {
            if ("__TAURI_INTERNALS__" in window) void invoke("reset_widget_position");
          }}><CornerDownRight size={13} aria-hidden="true" /></button>
          <button className="widget-refresh" aria-label="Minimize Codex meter" title="Minimize meter — restore from tray menu" onClick={() => {
            changeExpanded(false);
            if ("__TAURI_INTERNALS__" in window) void invoke("hide_codex_widget");
          }}><Minus size={13} aria-hidden="true" /></button>
          <button className="widget-refresh widget-close" aria-label="Quit UsageBar" title="Close UsageBar" onClick={() => {
            if ("__TAURI_INTERNALS__" in window) void invoke("quit_app");
          }}><X size={13} aria-hidden="true" /></button>
        </span>
      </header>
      <QuotaRow label="5h" bucket={fiveHour} now={now} stale={stale} />
      <QuotaRow label="Weekly" bucket={weekly} now={now} stale={stale} />
      </>}
    </main>
  );
}
