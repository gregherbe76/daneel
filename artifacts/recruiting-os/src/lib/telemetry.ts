// Opt-in PostHog telemetry wrapper.
//
// IMPORTANT — DO NOT EXTEND THE EVENT PAYLOAD SHAPE.
// Only the six events declared in `TelemetryEvent` are allowed, and only the
// fields declared in `TelemetryProps` may be sent. No candidate data, no JD
// content, no email, no name, no free-text. If you need a new event, update
// /docs/TELEMETRY.md first and add it explicitly to the union below.

import type { PostHog } from "posthog-js";

export type TelemetryEvent =
  | "workflow_started"
  | "workflow_completed"
  | "provider_card_viewed"
  | "provider_connect_clicked"
  | "provider_connected"
  | "providers_marketplace_opened";

const ALLOWED_EVENTS: ReadonlySet<TelemetryEvent> = new Set([
  "workflow_started",
  "workflow_completed",
  "provider_card_viewed",
  "provider_connect_clicked",
  "provider_connected",
  "providers_marketplace_opened",
]);

export interface TelemetryProps {
  provider?: string;
  workflow_step?: string;
}

// Forces a payload object to contain ONLY keys declared in `TelemetryProps`.
// Any extra key is typed as `never`, so passing it (even via an intermediate
// variable, where TS's normal excess-property check would not fire) produces
// a compile-time error. This is what catches accidental PII like
// `{ candidateEmail }` at `pnpm typecheck` time, not just at runtime.
//
// The param type for `track` below intersects `P` with this brand so that
// inference picks `P` up from the actual argument shape — without that, TS
// would happily widen `P` to `TelemetryProps` and miss the extra keys.
type NoExtraKeys<P> = {
  [K in Exclude<keyof P, keyof TelemetryProps>]: never;
};

const CONSENT_KEY = "daneel.telemetryConsent";
const ANON_ID_KEY = "daneel.telemetryAnonId";

export type ConsentState = "granted" | "denied" | null;

let posthog: PostHog | null = null;
let initialized = false;

const consentListeners = new Set<() => void>();

export interface RecentTelemetryEntry {
  event: TelemetryEvent;
  timestamp: string;
  payloadKeys: string[];
}

const RECENT_BUFFER_LIMIT = 20;
const recentBuffer: RecentTelemetryEntry[] = [];
const recentListeners = new Set<() => void>();

function notifyRecent() {
  recentListeners.forEach((l) => l());
}

export function getRecentEvents(): readonly RecentTelemetryEntry[] {
  return recentBuffer.slice();
}

export function subscribeRecentEvents(listener: () => void): () => void {
  recentListeners.add(listener);
  return () => {
    recentListeners.delete(listener);
  };
}

function isDev(): boolean {
  return Boolean(import.meta.env.DEV);
}

function getKey(): string | undefined {
  const k = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  return k && k.trim() !== "" ? k : undefined;
}

function getHost(): string {
  const h = import.meta.env.VITE_POSTHOG_HOST as string | undefined;
  return h && h.trim() !== "" ? h : "https://eu.i.posthog.com";
}

function getOrCreateAnonId(): string {
  if (typeof window === "undefined") return "anon";
  let id = window.localStorage.getItem(ANON_ID_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `anon-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    window.localStorage.setItem(ANON_ID_KEY, id);
  }
  return id;
}

export function getConsent(): ConsentState {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(CONSENT_KEY);
  if (v === "granted" || v === "denied") return v;
  return null;
}

function notifyConsent() {
  consentListeners.forEach((l) => l());
}

export function subscribeConsent(listener: () => void): () => void {
  consentListeners.add(listener);
  return () => {
    consentListeners.delete(listener);
  };
}

async function loadAndInit(): Promise<void> {
  if (initialized) return;
  if (isDev()) return;
  const key = getKey();
  if (!key) return;
  try {
    const mod = await import("posthog-js");
    const ph = mod.default;
    ph.init(key, {
      api_host: getHost(),
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      persistence: "localStorage",
      bootstrap: { distinctID: getOrCreateAnonId() },
    });
    ph.identify(getOrCreateAnonId());
    posthog = ph;
    initialized = true;
  } catch {
    // network/CSP failure — silently disable
  }
}

/**
 * Initializes PostHog if (and only if) the user has previously granted consent.
 * Safe to call on every app boot. No-ops in dev, when the key is missing, or
 * when consent has not been granted.
 */
export function initIfConsented(): void {
  if (isDev()) return;
  if (!getKey()) return;
  if (getConsent() !== "granted") return;
  void loadAndInit();
}

/**
 * Records the user's choice. Granting consent triggers PostHog initialization;
 * denying revokes capture and resets local state.
 */
export function setConsent(granted: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CONSENT_KEY, granted ? "granted" : "denied");
  notifyConsent();
  if (granted) {
    void loadAndInit();
  } else {
    if (posthog) {
      try {
        posthog.opt_out_capturing();
        posthog.reset();
      } catch {
        // ignore
      }
    }
    posthog = null;
    initialized = false;
  }
}

/**
 * Emits one of the six allow-listed events. No-ops in dev, without consent,
 * without a configured key, or before initialization.
 *
 * DO NOT pass fields outside `TelemetryProps` — see the comment at the top of
 * this file. The event name is constrained to the `TelemetryEvent` union at
 * compile time; payload field names are the contract you must not break.
 */
export function track<P extends TelemetryProps>(
  event: TelemetryEvent,
  props: P & NoExtraKeys<P> = {} as P & NoExtraKeys<P>,
): void {
  if (isDev()) return;
  if (!getKey()) return;
  if (getConsent() !== "granted") return;
  if (!ALLOWED_EVENTS.has(event)) return;
  if (!initialized || !posthog) return;
  const safe: Record<string, string> = {
    timestamp: new Date().toISOString(),
  };
  if (props.provider) safe.provider = props.provider;
  if (props.workflow_step) safe.workflow_step = props.workflow_step;
  try {
    posthog.capture(event, safe);
    const entry: RecentTelemetryEntry = {
      event,
      timestamp: safe.timestamp,
      payloadKeys: Object.keys(safe).sort(),
    };
    recentBuffer.push(entry);
    if (recentBuffer.length > RECENT_BUFFER_LIMIT) {
      recentBuffer.splice(0, recentBuffer.length - RECENT_BUFFER_LIMIT);
    }
    notifyRecent();
  } catch {
    // never let telemetry break the app
  }
}
