"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Shield, Users as UsersIcon, Key, KeyRound, Lock, Pause, Play,
  RefreshCw, ScrollText, Package, Download, Upload, Database,
  AlertTriangle, Server, Settings as SettingsIcon, Store, Printer,
  QrCode, Receipt, FileWarning,
} from "lucide-react";
import Link from "next/link";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, PageLoader, Screen, useToast, Modal, EmptyState } from "@/components/ui";

interface AdminUser {
  id: number;
  name: string;
  role: string;
  authMethod: "pin" | "password";
  username: string | null;
  isHeld: boolean;
  mustChangePassword?: boolean;
}
interface LoginLog { id: number; name: string; role: string; status: string; at: string; ip: string }

export default function AdminPage() {
  const toast = useToast();
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [logs, setLogs]   = useState<LoginLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetPinOf, setResetPinOf] = useState<AdminUser | null>(null);
  const [resetPassOf, setResetPassOf] = useState<AdminUser | null>(null);
  const [setAuthOf, setSetAuthOf]     = useState<AdminUser | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiGet<AdminUser[]>("/admin/users").catch(() => []),
      apiGet<LoginLog[]>("/admin/login-logs").catch(() => []),
    ]).then(([u, l]) => {
      setUsers(Array.isArray(u) ? u : []);
      setLogs(Array.isArray(l) ? l : []);
    }).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  async function toggleHold(u: AdminUser) {
    const action = u.isHeld ? "unhold" : "hold";
    if (!confirm(`${u.isHeld ? "Re-enable" : "Suspend"} ${u.name}?`)) return;
    try {
      await apiPost(`/admin/users/${u.id}/${action}`);
      toast.push("ok", `${u.name} ${u.isHeld ? "re-enabled" : "suspended"}`);
      load();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  async function backupDb() {
    try {
      const r = await apiPost<{ ok: boolean; path?: string }>("/settings/backup");
      toast.push("ok", `Backup ok${r.path ? ` → ${r.path}` : ""}`);
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  const canAdmin = user?.role === "admin" || user?.role === "superManager";

  if (!canAdmin) {
    return <EmptyState title="Not available" hint="Only an administrator or super manager can open this page." icon={<Shield size={32} />} />;
  }
  if (loading) return <PageLoader label="Loading admin" />;

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Admin" subtitle="User access, sign-in method and system maintenance" icon={Shield}>
          <button onClick={load} className="btn btn-ghost btn-sm"><RefreshCw size={14} /> Refresh</button>
        </PageHeader>

        <div className="grid lg:grid-cols-3 gap-3 mb-5">
          <AdminTile icon={<UsersIcon size={16} />} label="Total users" value={String(users.length)} />
          <AdminTile icon={<Lock size={16} />}     label="Suspended"   value={String(users.filter((u) => u.isHeld).length)} />
          <AdminTile icon={<ScrollText size={16} />} label="Login events (recent)" value={String(logs.length)} />
        </div>

        {/* System maintenance */}
        <div className="eyebrow mb-3">System</div>
        <div className="grid sm:grid-cols-3 gap-2 mb-5">
          <button onClick={backupDb} className="btn btn-soft"><Database size={14} /> Backup DB</button>
          <a href="/api/settings/export" target="_blank" rel="noreferrer" className="btn btn-ghost">
            <Download size={14} /> Export settings
          </a>
          <a href="/api/settings/health" target="_blank" rel="noreferrer" className="btn btn-ghost">
            <Server size={14} /> Health check
          </a>
          <a href="/api/fiscal/export" target="_blank" rel="noreferrer" className="btn btn-ghost">
            <Receipt size={14} /> Fiscal export
          </a>
          <button
            onClick={async () => {
              if (!confirm("⚠️ Wipe all orders / shifts / petty cash / messages (keeps users, menu, settings)? Cannot be undone.")) return;
              try { await apiPost("/settings/reset-test-data"); toast.push("ok", "Test data cleared"); load(); }
              catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
            }}
            className="btn btn-danger"
          >
            <AlertTriangle size={14} /> Clear test data
          </button>
          <Link href="/settings" className="btn btn-ghost">
            <SettingsIcon size={14} /> Open Settings
          </Link>
        </div>

        {/* Shortcuts to common admin tasks */}
        <div className="eyebrow mb-3">Shortcuts</div>
        <div className="grid sm:grid-cols-3 gap-2 mb-5">
          <Link href="/branches" className="btn btn-ghost"><Store size={14} /> Branches</Link>
          <Link href="/menu-admin" className="btn btn-ghost"><Package size={14} /> Menu, categories, stations</Link>
          <Link href="/audit" className="btn btn-ghost"><FileWarning size={14} /> Change audit log</Link>
        </div>
      </Screen>

      {/* ---- Users table ---- */}
      <Screen>
        <h2 className="text-[15px] font-semibold text-ink mb-4">User access</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted text-[11px] uppercase tracking-wider font-semibold">
                <th className="py-2.5">Name</th>
                <th>Role</th>
                <th>Sign-in</th>
                <th>Status</th>
                <th className="text-right pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-line-soft">
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="size-8 rounded-full flex items-center justify-center text-[12px] font-bold text-white"
                        style={{ background: u.role === "admin" ? "var(--bad)" : "var(--olive)" }}>
                        {u.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="font-medium text-ink">{u.name}</span>
                    </div>
                  </td>
                  <td><span className={`pill ${u.role === "admin" ? "pill-bad" : u.role === "superManager" ? "pill-clay" : "pill-olive"}`}>{u.role}</span></td>
                  <td className="text-muted">
                    {u.authMethod === "password" ? <>@{u.username}</> : "PIN"}
                    {u.mustChangePassword && <span className="pill pill-warn ml-2">must change</span>}
                  </td>
                  <td>{u.isHeld ? <span className="pill pill-bad">suspended</span> : <span className="pill pill-ok">active</span>}</td>
                  <td className="text-right pr-4">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => setSetAuthOf(u)} className="btn btn-ghost btn-sm !px-2" title="Change sign-in method">
                        <KeyRound size={13} />
                      </button>
                      {u.authMethod === "pin" ? (
                        <button onClick={() => setResetPinOf(u)} className="btn btn-ghost btn-sm !px-2" title="Reset PIN">
                          <Key size={13} />
                        </button>
                      ) : (
                        <button onClick={() => setResetPassOf(u)} className="btn btn-ghost btn-sm !px-2" title="Reset password">
                          <Lock size={13} />
                        </button>
                      )}
                      <button onClick={() => toggleHold(u)} className="btn btn-ghost btn-sm !px-2" title={u.isHeld ? "Re-enable" : "Suspend"}>
                        {u.isHeld ? <Play size={13} /> : <Pause size={13} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Screen>

      {/* ---- Recent login activity ---- */}
      <Screen>
        <h2 className="text-[15px] font-semibold text-ink mb-4 flex items-center gap-2">
          <ScrollText size={15} style={{ color: "var(--olive)" }} /> Recent logins
        </h2>
        {!logs.length ? (
          <EmptyState title="No login activity yet" />
        ) : (
          <div className="flex flex-col gap-1">
            {logs.slice(0, 30).map((l) => (
              <div key={l.id} className="flex items-center gap-3 rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--panel-2)" }}>
                <span className={`pill ${l.status === "ok" ? "pill-ok" : "pill-bad"}`}>{l.status}</span>
                <span className="font-medium text-ink">{l.name}</span>
                <span className="text-muted">({l.role})</span>
                <span className="text-muted ml-auto">{(l.at || "").replace("T", " ").slice(0, 16)}</span>
                <span className="text-muted text-[11px] font-mono">{l.ip}</span>
              </div>
            ))}
          </div>
        )}
      </Screen>

      {resetPinOf && (
        <ResetPinModal
          user={resetPinOf}
          onClose={() => setResetPinOf(null)}
          onDone={() => { setResetPinOf(null); load(); toast.push("ok", "PIN reset"); }}
        />
      )}
      {resetPassOf && (
        <ResetPasswordModal
          user={resetPassOf}
          onClose={() => setResetPassOf(null)}
          onDone={() => { setResetPassOf(null); load(); toast.push("ok", "Password reset"); }}
        />
      )}
      {setAuthOf && (
        <SetAuthModal
          user={setAuthOf}
          onClose={() => setSetAuthOf(null)}
          onDone={() => { setSetAuthOf(null); load(); toast.push("ok", "Sign-in method changed"); }}
        />
      )}
    </div>
  );
}

function AdminTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}>
      <div className="flex items-center gap-2 mb-2" style={{ color: "var(--olive)" }}>
        {icon}
        <span className="text-[11px] uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <div className="mono text-[20px] font-semibold text-ink leading-none">{value}</div>
    </div>
  );
}

function ResetPinModal({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (pin.length < 4) { toast.push("bad", "PIN must be at least 4 digits"); return; }
    setBusy(true);
    try { await apiPost(`/admin/users/${user.id}/reset-pin`, { pin }); onDone(); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <Modal open title={`Reset PIN — ${user.name}`} onClose={onClose} width={360}>
      <div className="space-y-3">
        <div><label className="lbl">New PIN (4-10 digits)</label>
          <input className="inp mono text-[16px] tracking-widest" type="password" inputMode="numeric" maxLength={10}
            value={pin} autoFocus onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} /></div>
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">
          {busy ? "Saving…" : "Reset PIN"}
        </button>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (pass.length < 6) { toast.push("bad", "At least 6 characters"); return; }
    setBusy(true);
    try { await apiPost(`/admin/users/${user.id}/reset-password`, { tempPassword: pass }); onDone(); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <Modal open title={`Reset password — ${user.name}`} onClose={onClose} width={360}>
      <div className="space-y-3">
        <div><label className="lbl">Temporary password (6+ chars)</label>
          <input className="inp" type="password" value={pass} autoFocus onChange={(e) => setPass(e.target.value)} /></div>
        <p className="text-[11.5px] text-muted">User will be asked to change it on next sign-in.</p>
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">
          {busy ? "Saving…" : "Reset password"}
        </button>
      </div>
    </Modal>
  );
}

function SetAuthModal({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [method, setMethod] = useState<"pin" | "password">(user.authMethod);
  const [pin, setPin] = useState("");
  const [username, setUsername] = useState(user.username || "");
  const [tempPassword, setTempPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const payload = method === "pin"
        ? { authMethod: "pin", pin }
        : { authMethod: "password", username, tempPassword };
      await apiPost(`/admin/users/${user.id}/set-auth`, payload);
      onDone();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <Modal open title={`Sign-in method — ${user.name}`} onClose={onClose} width={420}>
      <div className="space-y-3">
        <div>
          <label className="lbl">Method</label>
          <div className="flex gap-1.5 p-1 rounded-full" style={{ background: "var(--panel-2)" }}>
            {(["pin", "password"] as const).map((m) => (
              <button key={m} onClick={() => setMethod(m)}
                className="flex-1 py-1.5 rounded-full text-[12.5px] font-semibold capitalize transition-colors"
                style={method === m
                  ? { background: "var(--panel)", color: "var(--olive-700)", boxShadow: "var(--shadow-sm)" }
                  : { color: "var(--muted)" }}>
                {m}
              </button>
            ))}
          </div>
        </div>
        {method === "pin" ? (
          <div><label className="lbl">New PIN (4-10 digits)</label>
            <input className="inp mono tracking-widest" type="password" inputMode="numeric" maxLength={10}
              value={pin} autoFocus onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} /></div>
        ) : (
          <>
            <div><label className="lbl">Username</label>
              <input className="inp" value={username} autoFocus onChange={(e) => setUsername(e.target.value)} /></div>
            <div><label className="lbl">Temporary password (6+ chars)</label>
              <input className="inp" type="password" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} /></div>
          </>
        )}
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">
          {busy ? "Saving…" : "Change sign-in method"}
        </button>
      </div>
    </Modal>
  );
}
