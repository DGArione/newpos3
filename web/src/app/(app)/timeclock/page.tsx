"use client";

import { useEffect, useState } from "react";
import { LogIn, LogOut, Clock } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, PageLoader, EmptyState, useToast } from "@/components/ui";

interface Shift { id: number; userId: number; userName: string; clockIn: string; clockOut: string | null; }

function fmt(s: string | null) { return s ? s.replace("T", " ").slice(0, 16) : "—"; }
function hours(a: string, b: string | null) {
  const end = b ? new Date(b.replace(" ", "T")).getTime() : Date.now();
  const h = (end - new Date(a.replace(" ", "T")).getTime()) / 3600000;
  return h > 0 ? h.toFixed(2) : "0.00";
}

export default function TimeclockPage() {
  const toast = useToast();
  const { user } = useAuth();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = () => apiGet<Shift[]>("/shifts").then((d) => setShifts(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const myOpen = shifts.find((s) => s.userId === user?.id && !s.clockOut);

  async function punch() {
    setBusy(true);
    try {
      await apiPost(myOpen ? "/shifts/clockout" : "/shifts/clockin", {});
      toast.push("ok", myOpen ? "Clocked out — have a good one" : "Clocked in — welcome");
      setLoading(true); load();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader title="Time clock" subtitle="Clock in and out, and review shifts." />

      <div className="gb-card p-6 mb-6 flex flex-col sm:flex-row items-center justify-between gap-4"
        style={{ background: myOpen ? "linear-gradient(135deg, var(--olive-700), var(--olive))" : "var(--panel)", borderColor: myOpen ? "transparent" : "var(--line)" }}>
        <div style={{ color: myOpen ? "#ffffff" : "var(--ink)" }}>
          <div className="text-sm opacity-80">{myOpen ? "On shift since" : "You're clocked out"}</div>
          <div className="font-head text-2xl">{myOpen ? `${fmt(myOpen.clockIn)} · ${hours(myOpen.clockIn, null)}h` : "Ready when you are"}</div>
        </div>
        <button onClick={punch} disabled={busy} className={`btn btn-lg ${myOpen ? "btn-primary" : "btn-olive"}`}>
          {myOpen ? <><LogOut size={18} /> Clock out</> : <><LogIn size={18} /> Clock in</>}
        </button>
      </div>

      {loading ? <PageLoader /> : !shifts.length ? <EmptyState title="No shifts yet" icon={<Clock size={30} />} /> : (
        <div className="gb-card overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted text-[11px] uppercase tracking-wide" style={{ background: "var(--panel-2)" }}>
              <th className="py-2.5 px-4">Staff</th><th>Clock in</th><th>Clock out</th><th>Hours</th>
            </tr></thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.id} className="border-t border-line-soft">
                  <td className="py-2.5 px-4 font-medium">{s.userName}</td>
                  <td className="text-muted">{fmt(s.clockIn)}</td>
                  <td className="text-muted">{s.clockOut ? fmt(s.clockOut) : <span className="pill pill-ok">On shift</span>}</td>
                  <td className="mono font-semibold">{hours(s.clockIn, s.clockOut)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
