"use client";

import { useEffect, useState } from "react";
import { MessageSquare, Send, Plus } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { PageHeader, PageLoader, EmptyState, useToast, Modal } from "@/components/ui";

interface Thread { threadId: number; to: string; subject: string; lastMessage: { body: string; fromName: string; createdAt: string } | string; messageCount: number; unread: number; }

const ROLES = [["all", "Everyone"], ["manager", "Managers"], ["server", "Servers"], ["cashier", "Cashiers"], ["kitchen", "Kitchen"]] as const;

export default function MessagesPage() {
  const toast = useToast();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = () => apiGet<Thread[]>("/messages/threads").then((d) => setThreads(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader title="Messages" subtitle="Notes to the team, by role.">
        <button onClick={() => setOpen(true)} className="btn btn-primary btn-sm"><Plus size={15} /> New message</button>
      </PageHeader>

      {loading ? <PageLoader /> : !threads.length ? <EmptyState title="No messages" hint="Start a thread for the floor or kitchen." icon={<MessageSquare size={30} />} /> : (
        <div className="flex flex-col gap-2">
          {threads.map((t) => {
            const last = typeof t.lastMessage === "string" ? t.lastMessage : t.lastMessage?.body || "";
            return (
              <div key={t.threadId} className="gb-card p-4">
                <div className="flex justify-between items-start gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="pill pill-olive capitalize">{t.to}</span>
                      {t.unread > 0 && <span className="pill pill-clay">{t.unread} new</span>}
                    </div>
                    <div className="text-sm text-ink mt-1.5 truncate">{t.subject || last}</div>
                    <div className="text-[12px] text-muted truncate mt-0.5">{last}</div>
                  </div>
                  <span className="text-[12px] text-muted whitespace-nowrap">{t.messageCount} msg</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && <Compose onClose={() => setOpen(false)} onDone={() => { setOpen(false); setLoading(true); load(); toast.push("ok", "Message sent"); }} />}
    </div>
  );
}

function Compose({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [toRole, setToRole] = useState("all");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    try { await apiPost("/messages", { toRole, body }); onDone(); } catch { setBusy(false); }
  }
  return (
    <Modal open title="New message" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="lbl">To</label>
          <div className="flex flex-wrap gap-2">
            {ROLES.map(([k, label]) => (
              <button key={k} onClick={() => setToRole(k)} className="px-3 py-1.5 rounded-full text-[13px] font-medium border transition-colors"
                style={toRole === k ? { background: "var(--olive)", color: "#ffffff", borderColor: "var(--olive)" } : { background: "var(--panel)", borderColor: "var(--line)", color: "var(--ink)" }}>{label}</button>
            ))}
          </div>
        </div>
        <div><label className="lbl">Message</label><textarea className="inp min-h-24" value={body} onChange={(e) => setBody(e.target.value)} /></div>
        <button onClick={send} disabled={busy} className="btn btn-primary w-full"><Send size={15} /> Send</button>
      </div>
    </Modal>
  );
}
