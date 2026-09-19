"use client";
/**
 * Notes on one thing, and the box to add another.
 *
 * Drops into any screen with two props — what kind of thing, and which one.
 * That is the whole integration: the backend addresses notes by that pair, so a
 * machine, an operator, a leave request and a shift all get the same thread
 * without a line of server code each.
 *
 * WHAT IT BORROWS FROM CLICKUP AND WHAT IT DOES NOT. Mentions, replies,
 * resolving and pinning — those earn their place, because a note that asks
 * somebody for something needs to reach them and then be closed. Reactions,
 * rich text, threading below one level and attachments are absent: this is a
 * register people annotate between other jobs, not a place they live.
 *
 * Typing @ opens the list of people who can actually open this page. Mentioning
 * somebody who cannot is a message into a void.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MessageSquare, Loader2, Send, Pin, Check, CornerDownRight, Pencil,
  Trash2, X, AtSign,
} from "lucide-react";
import api from "@/lib/api";
import { Avatar, Button, Chip } from "@/components/minehub/ui";

export type EntityKind =
  | "ASSET" | "OPERATOR" | "SHIFT" | "DEPLOYMENT" | "HOTO"
  | "LEAVE" | "EXCEPTION" | "PATTERN" | "PLANT";

export interface Note {
  comment_id: number; parent_id: number | null; body: string;
  mentions: string[]; mention_names: Record<string, string>;
  is_resolved: boolean; resolved_by: string | null; resolved_by_name: string | null;
  resolved_at: string | null; is_pinned: boolean;
  author_emp_id: string; author_name: string;
  created_at: string; edited_at: string | null;
  replies?: Note[];
}

interface Person { emp_id: string; name: string }

/** When it was said, the way somebody would say it. */
export function said(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN",
    { day: "2-digit", month: "short", year: "numeric" });
}

/** Draw @3090 as the person's name, not the number. */
export function Body({ text, names }: { text: string; names: Record<string, string> }) {
  const parts = text.split(/(@[A-Za-z0-9_.-]{2,32})/g);
  return (
    <p className="text-[13px] text-txt-primary whitespace-pre-wrap break-words leading-relaxed">
      {parts.map((part, i) => {
        if (!part.startsWith("@")) return <span key={i}>{part}</span>;
        const id = part.slice(1);
        return (
          <span key={i} className="inline-flex items-center rounded bg-sky-bg px-1
                                   text-sky font-semibold" title={id}>
            @{names[id] ?? id}
          </span>
        );
      })}
    </p>
  );
}

export default function CommentThread({
  entityType, entityId, title = "Notes", compact, onChanged,
}: {
  entityType: EntityKind;
  entityId: number;
  title?: string;
  compact?: boolean;
  onChanged?: () => void;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [me, setMe] = useState("");
  const [rights, setRights] = useState({ write: false, moderate: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<Note | null>(null);
  const [editing, setEditing] = useState<Note | null>(null);

  const [people, setPeople] = useState<Person[]>([]);
  const [picking, setPicking] = useState(false);
  const [pickQuery, setPickQuery] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/comments/thread/${entityType}/${entityId}`);
      setNotes(r.data?.comments ?? []);
      setMe(r.data?.me ?? "");
      setRights({ write: Boolean(r.data?.may_write),
                  moderate: Boolean(r.data?.may_moderate) });
      setError(null);
    } catch {
      setError("The notes could not be read.");
    } finally { setLoading(false); }
  }, [entityType, entityId]);

  useEffect(() => { void load(); }, [load]);

  // The mention list is fetched once, when somebody first types @, rather than
  // on every mount — most visits to a thread never mention anybody.
  useEffect(() => {
    if (!picking || people.length) return;
    void api.get("/comments/meta/people")
      .then((r) => setPeople(r.data ?? []))
      .catch(() => setPeople([]));
  }, [picking, people.length]);

  const matches = useMemo(() => {
    const term = pickQuery.toLowerCase();
    return people.filter((p) => !term
      || p.name.toLowerCase().includes(term) || p.emp_id.includes(term)).slice(0, 6);
  }, [people, pickQuery]);

  /** Watch the caret for an @ that has not been completed yet. */
  const onType = (value: string) => {
    setDraft(value);
    const upto = value.slice(0, box.current?.selectionStart ?? value.length);
    const open = /@([A-Za-z0-9_.-]*)$/.exec(upto);
    setPicking(Boolean(open));
    setPickQuery(open?.[1] ?? "");
  };

  const insert = (person: Person) => {
    const el = box.current;
    const at = el?.selectionStart ?? draft.length;
    const before = draft.slice(0, at).replace(/@([A-Za-z0-9_.-]*)$/, "");
    const next = `${before}@${person.emp_id} ${draft.slice(at)}`;
    setDraft(next);
    setPicking(false);
    requestAnimationFrame(() => {
      el?.focus();
      const caret = before.length + person.emp_id.length + 2;
      el?.setSelectionRange(caret, caret);
    });
  };

  const send = async () => {
    const said = draft.trim();
    if (!said) return;
    setBusy(true);
    try {
      if (editing) {
        await api.patch(`/comments/${editing.comment_id}`, { body: said });
      } else {
        await api.post(`/comments/thread/${entityType}/${entityId}`, {
          body: said, parent_id: replyTo?.comment_id ?? null,
        });
      }
      setDraft(""); setReplyTo(null); setEditing(null);
      await load(); onChanged?.();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "That note could not be saved.");
    } finally { setBusy(false); }
  };

  const act = async (note: Note, what: "resolve" | "pin" | "delete") => {
    setBusy(true);
    try {
      if (what === "delete") await api.delete(`/comments/${note.comment_id}`);
      else await api.post(`/comments/${note.comment_id}/${what}`, {});
      await load(); onChanged?.();
    } catch {
      setError("That could not be changed.");
    } finally { setBusy(false); }
  };

  const startEdit = (note: Note) => {
    setEditing(note); setReplyTo(null); setDraft(note.body);
    requestAnimationFrame(() => box.current?.focus());
  };

  const One = ({ note, isReply }: { note: Note; isReply?: boolean }) => (
    <div className={`group ${isReply ? "ml-8 pl-3 border-l-2 border-slate-100" : ""}`}>
      <div className="flex items-start gap-2.5 py-2">
        <Avatar name={note.author_name} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[12.5px] font-semibold text-navy">{note.author_name}</span>
            <span className="text-[11px] text-txt-light">{said(note.created_at)}</span>
            {note.edited_at && (
              <span className="text-[10.5px] text-txt-light italic">edited</span>
            )}
            {note.is_pinned && <Chip tone="gold" dot={false}><Pin className="w-3 h-3" /></Chip>}
            {note.is_resolved && (
              <Chip tone="emerald" dot={false}>
                <Check className="w-3 h-3" />
                {note.resolved_by_name ? `closed by ${note.resolved_by_name}` : "closed"}
              </Chip>
            )}
          </div>

          <div className={note.is_resolved ? "opacity-60" : ""}>
            <Body text={note.body} names={note.mention_names ?? {}} />
          </div>

          {rights.write && (
            <div className="flex flex-wrap items-center gap-3 mt-1
                            opacity-0 group-hover:opacity-100 focus-within:opacity-100
                            transition">
              {!isReply && (
                <button onClick={() => { setReplyTo(note); setEditing(null);
                                         requestAnimationFrame(() => box.current?.focus()); }}
                  className="text-[11px] text-txt-muted hover:text-navy inline-flex items-center gap-1">
                  <CornerDownRight className="w-3 h-3" /> Reply
                </button>
              )}
              {!isReply && (
                <button onClick={() => void act(note, "resolve")}
                  className="text-[11px] text-txt-muted hover:text-emerald inline-flex items-center gap-1">
                  <Check className="w-3 h-3" /> {note.is_resolved ? "Reopen" : "Mark done"}
                </button>
              )}
              {!isReply && (
                <button onClick={() => void act(note, "pin")}
                  className="text-[11px] text-txt-muted hover:text-gold inline-flex items-center gap-1">
                  <Pin className="w-3 h-3" /> {note.is_pinned ? "Unpin" : "Pin"}
                </button>
              )}
              {note.author_emp_id === me && (
                <button onClick={() => startEdit(note)}
                  className="text-[11px] text-txt-muted hover:text-navy inline-flex items-center gap-1">
                  <Pencil className="w-3 h-3" /> Edit
                </button>
              )}
              {(note.author_emp_id === me || rights.moderate) && (
                <button onClick={() => void act(note, "delete")}
                  className="text-[11px] text-txt-muted hover:text-rose inline-flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {(note.replies ?? []).map((r) => (
        <One key={r.comment_id} note={r} isReply />
      ))}
    </div>
  );

  const open = notes.filter((n) => !n.is_resolved).length;

  return (
    <div className={compact ? "" : "rounded-xl border border-slate-200 bg-white"}>
      {!compact && (
        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-violet" />
          <span className="text-[12.5px] font-bold text-navy">{title}</span>
          {notes.length > 0 && (
            <Chip tone="slate" dot={false}>{notes.length}</Chip>
          )}
          {open > 0 && <Chip tone="amber" dot={false}>{open} open</Chip>}
        </div>
      )}

      {error && (
        <div className="px-4 py-2 text-[12px] text-rose bg-rose-bg flex items-center
                        justify-between gap-2">
          <span>{error}</span>
          <button onClick={() => setError(null)}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      <div className="px-4 py-1 divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
        {loading ? (
          <p className="py-6 text-center text-[12px] text-txt-light">
            <Loader2 className="w-4 h-4 animate-spin mx-auto" />
          </p>
        ) : notes.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-txt-light">
            Nothing noted yet. Anything worth telling the next person goes here.
          </p>
        ) : (
          notes.map((n) => <One key={n.comment_id} note={n} />)
        )}
      </div>

      {rights.write && (
        <div className="px-4 py-3 border-t border-slate-100 relative">
          {(replyTo || editing) && (
            <div className="mb-1.5 flex items-center gap-2 text-[11.5px] text-txt-muted">
              {editing ? <Pencil className="w-3 h-3" /> : <CornerDownRight className="w-3 h-3" />}
              {editing ? "Editing your note"
                       : `Replying to ${replyTo?.author_name}`}
              <button onClick={() => { setReplyTo(null); setEditing(null); setDraft(""); }}
                className="text-txt-light hover:text-rose">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          <div className="flex items-end gap-2">
            <textarea ref={box} rows={compact ? 2 : 2} value={draft}
              onChange={(e) => onType(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setPicking(false); }
                // Enter sends, Shift+Enter breaks the line — the way every
                // message box people already use behaves.
                if (e.key === "Enter" && !e.shiftKey && !picking) {
                  e.preventDefault(); void send();
                }
              }}
              placeholder="Write a note… type @ to tell somebody"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[13px]
                         text-txt-primary placeholder:text-txt-light resize-y
                         focus:outline-none focus:ring-2 focus:ring-gold/30
                         focus:border-gold/50" />
            <Button variant="primary" size="sm" disabled={busy || !draft.trim()}
                    onClick={() => void send()}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Send className="w-3.5 h-3.5" />}
              {editing ? "Save" : "Post"}
            </Button>
          </div>

          {picking && matches.length > 0 && (
            <div className="absolute bottom-full left-4 mb-1 w-64 rounded-lg border
                            border-slate-200 bg-white shadow-lg overflow-hidden z-20">
              <p className="px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide
                            text-txt-light bg-slate-50 flex items-center gap-1">
                <AtSign className="w-3 h-3" /> Tell somebody
              </p>
              {matches.map((p) => (
                <button key={p.emp_id} onClick={() => insert(p)}
                  className="w-full px-3 py-1.5 flex items-center gap-2 text-left
                             hover:bg-gold/[0.07]">
                  <Avatar name={p.name} size="sm" />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold text-navy truncate">
                      {p.name}
                    </span>
                    <span className="block text-[10.5px] text-txt-light">{p.emp_id}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
