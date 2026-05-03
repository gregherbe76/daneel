import { useEffect, useState, useCallback } from "react";
import type { TeamMember } from "@workspace/api-client-react";

const STORAGE_KEY = "hiringai.currentUserId";
const LAST_READ_KEY = "hiringai.mentionsLastReadAt";
const DEFAULT_USER_ID = "alex";

function readUserId(): string {
  if (typeof window === "undefined") return DEFAULT_USER_ID;
  return window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_USER_ID;
}

export function useCurrentUserId(): [string, (id: string) => void] {
  const [id, setId] = useState<string>(() => readUserId());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setId(readUserId());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const update = useCallback((next: string) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    setId(next);
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
  }, []);

  return [id, update];
}

export function useCurrentUser(roster: TeamMember[] | undefined): TeamMember | undefined {
  const [id] = useCurrentUserId();
  return roster?.find((m) => m.id === id) ?? roster?.[0];
}

export function getMentionsLastRead(userId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(`${LAST_READ_KEY}:${userId}`);
}

export function setMentionsLastRead(userId: string, iso: string) {
  window.localStorage.setItem(`${LAST_READ_KEY}:${userId}`, iso);
  window.dispatchEvent(
    new StorageEvent("storage", { key: `${LAST_READ_KEY}:${userId}` }),
  );
}

export function useMentionsLastRead(userId: string): [string | null, (iso: string) => void] {
  const [value, setValue] = useState<string | null>(() => getMentionsLastRead(userId));

  useEffect(() => {
    setValue(getMentionsLastRead(userId));
    const onStorage = (e: StorageEvent) => {
      if (e.key === `${LAST_READ_KEY}:${userId}`) {
        setValue(getMentionsLastRead(userId));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [userId]);

  const update = useCallback(
    (iso: string) => {
      setMentionsLastRead(userId, iso);
      setValue(iso);
    },
    [userId],
  );

  return [value, update];
}
