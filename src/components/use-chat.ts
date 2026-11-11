"use client";
import { useEffect, useRef, useState } from "react";
import type { Session, StreamEvent, Turn } from "@/lib/types";
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Something went wrong.");
  return body;
}

export function useChat() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [sidebar, setSidebar] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (window.matchMedia("(max-width: 650px)").matches) setSidebar(false);
    api<{ sessions: Session[] }>("/api/sessions")
      .then((data) => setSessions(data.sessions))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    return () => abort.current?.abort();
  }, []);
  useEffect(() => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    end.current?.scrollIntoView({
      behavior: busy || reduceMotion ? "instant" : "smooth",
    });
  }, [turns, busy]);
  async function selectSession(id: string) {
    if (busy || loading) return;
    setLoading(true);
    setError("");
    try {
      const data = await api<{ turns: Turn[] }>(`/api/sessions/${id}`);
      setSessionId(id);
      setTurns(data.turns);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load conversation.");
    } finally {
      setLoading(false);
    }
  }
  async function send(text = question) {
    const trimmed = text.trim();
    if (!trimmed || busy || loading) return;
    setBusy(true);
    setQuestion("");
    setError("");
    setStatus("Connecting");
    let temporaryId = "";
    const controller = new AbortController();
    abort.current = controller;
    try {
      let id = sessionId;
      if (!id) {
        const { session } = await api<{ session: Session }>("/api/sessions", {
          method: "POST",
          signal: controller.signal,
        });
        id = session.id;
        setSessionId(id);
        setSessions((prev) => [session, ...prev]);
      }
      temporaryId = crypto.randomUUID();
      setTurns((prev) => [
        ...prev,
        {
          id: temporaryId,
          session_id: id!,
          question: trimmed,
          answer: "",
          created_at: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          sources: [],
          status: "pending",
        },
      ]);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: id,
          requestId: temporaryId,
          question: trimmed,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(
          (await response.json()).error || "Unable to start answer.",
        );
      if (!response.body) throw new Error("Streaming is unavailable.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      const update = (event: StreamEvent) => {
        if (event.type === "status") setStatus(event.text);
        if (event.type === "token")
          setTurns((prev) =>
            prev.map((t) =>
              t.id === temporaryId
                ? { ...t, answer: (t.answer || "") + event.text }
                : t,
            ),
          );
        if (event.type === "sources")
          setTurns((prev) =>
            prev.map((t) =>
              t.id === temporaryId ? { ...t, sources: event.sources } : t,
            ),
          );
        if (event.type === "error") throw new Error(event.text);
        if (event.type === "done") {
          done = true;
          setTurns((prev) =>
            prev.map((t) =>
              t.id === temporaryId
                ? { ...t, id: event.turnId, status: "complete" }
                : t,
            ),
          );
        }
      };
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line.trim()) update(JSON.parse(line));
        }
        if (chunk.done) break;
      }
      if (!done)
        throw new Error("The connection ended before the answer was saved.");
      const data = await api<{ sessions: Session[] }>("/api/sessions");
      setSessions(data.sessions);
    } catch (e) {
      controller.abort();
      setError(
        controller.signal.aborted &&
          e instanceof DOMException &&
          e.name === "AbortError"
          ? "Response stopped. You can send another message."
          : e instanceof Error
            ? e.message
            : "Unable to finish response.",
      );
      setTurns((prev) =>
        prev.map((t) =>
          t.id === temporaryId && t.status === "pending"
            ? { ...t, status: "error" }
            : t,
        ),
      );
    } finally {
      setBusy(false);
      setStatus("");
      abort.current = null;
      input.current?.focus();
    }
  }

  function newConversation() {
    setSessionId(null);
    setTurns([]);
    setError("");
    input.current?.focus();
  }
  return {
    sessions,
    sessionId,
    turns,
    question,
    setQuestion,
    busy,
    loading,
    status,
    error,
    sidebar,
    setSidebar,
    abort,
    end,
    input,
    selectSession,
    send,
    newConversation,
  };
}
