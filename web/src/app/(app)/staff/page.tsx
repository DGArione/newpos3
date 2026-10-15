"use client";

import { useEffect, useState } from "react";
import {
  Plus, Users as UsersIcon, ShieldCheck, Key, Pause, Play, Trash2,
  Lock, Pencil,
} from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { useAuth } from "@/lib/auth";
import { Role } from "@/lib/api";
import { PageHeader, PageLoader, EmptyState, Screen, useToast, Modal } from "@/components/ui";
import { KeyRound as KeyRoundIcon, Lock as LockIcon } from "lucide-react";

interface User {
  id: number;
  name: string;
  role: Role;
  payRate: number;
  payType: string;
  authMethod: string;
  username: string | null;
  isHeld: boolean;
  branchId: number | null;
}

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrator",
  superManager: "Super Manager",
  manager: "Manager",
  finance: "Finance",
  server: "Server",
  cashier: "Cashier",
  kitchen: "Kitchen",
};

const ROLE_PILL: Record<string, string> = {
  admin: "pill-bad",
  superManager: "pill-clay",
  manager: "pill-clay",
  finance: "pill-olive",
  server: "pill-ok",
  cashier: "pill-olive",
  kitchen: "pill-warn",
};

export default function StaffPage() {
  const toast = useToast();
  const { user } = useAuth();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [list, setList] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [pinOf, setPinOf] = useState<User | null>(null);
  const [passOf, setPassOf] = useState<User | null>(null);
  const [authOf, setAuthOf] = useState<User | null>(null);

  const load = () =>
    apiGet<User[]>("/users")
      .then((d) => setList(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const canManagePay = user?.role === "manager" || user?.role === "superManager";
  const canHold      = user?.role === "manager" || user?.role === "superManager" || user?.role === "admin";

  async function toggleHold(u: User) {
    const action = u.isHeld ? "unhold" : "hold";
    if (!confirm(`${u.isHeld ? "Re-enable" : "Suspend"} ${u.name}?`)) return;
    try {
      await apiPost(`/admin/users/${u.id}/${action}`);
      toast.push("ok", `${u.name} ${u.isHeld ? "re-enabled" : "suspended"}`);
      setLoading(true); load();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  async function resetPin(u: User) {
    const pin = prompt(`New PIN for ${u.name} (4-10 digits):`);
    if (!pin || pin.length < 4) return;
    try {
      await apiPost(`/admin/users/${u.id}/reset-pin`, { pin });
      toast.push("ok", `PIN reset for ${u.name}`);
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  async function resetPassword(u: User) {
    const pass = prompt(`New temporary password for ${u.name} (6+ chars):`);
    if (!pass || pass.length < 6) return;
    try {
      await apiPost(`/admin/users/${u.id}/reset-password`, { tempPassword: pass });
      toast.push("ok", `Password reset for ${u.name}. They must change on next sign-in.`);
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Users" subtitle={`${list.length} accounts`} icon={UsersIcon}>
          <button onClick={() => setOpen(true)} className="btn btn-primary btn-sm">
            <Plus size={14} /> New user
          </button>
        </PageHeader>

        {loading ? <PageLoader /> : !list.length ? (
          <EmptyState title="No users" icon={<UsersIcon size={30} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted text-[11px] uppercase tracking-wider font-semibold">
                  <th className="py-2.5">Name</th>
                  <th>Role</th>
                  <th>Sign-in</th>
                  {canManagePay && <th>Pay</th>}
                  <th>Status</th>
                  <th className="text-right pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((u) => (
                  <tr key={u.id} className="border-t border-line-soft">
                    <td className="py-2.5 font-medium">
                      <div className="flex items-center gap-2">
                        <span
                          className="size-8 rounded-full flex items-center justify-center text-[12px] font-bold text-white"
                          style={{ background: "var(--olive)" }}
                        >
                          {u.name.charAt(0).toUpperCase()}
                        </span>
                        {u.name}
                      </div>
                    </td>
                    <td><span className={`pill ${ROLE_PILL[u.role] || "pill-olive"}`}>{ROLE_LABEL[u.role] || u.role}</span></td>
                    <td className="text-muted capitalize">{u.authMethod === "password" ? `@${u.username}` : "PIN"}</td>
                    {canManagePay && (
                      <td className="mono">
                        {u.payRate > 0 ? `${money(u.payRate, currency)}/${u.payType === "hourly" ? "hr" : u.payType}` : "—"}
                      </td>
                    )}
                    <td>
                      {u.isHeld ? (
                        <span className="pill pill-bad">Suspended</span>
                      ) : (
                        <span className="pill pill-ok"><ShieldCheck size={11} /> Active</span>
                      )}
                    </td>
                    <td className="text-right pr-4">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => setAuthOf(u)} className="btn btn-ghost btn-sm !px-2" title="Change sign-in method (PIN ↔ username/password)">
                          <KeyRoundIcon size={13} />
                        </button>
                        {u.authMethod === "pin" ? (
                          <button onClick={() => resetPin(u)} className="btn btn-ghost btn-sm !px-2" title="Reset PIN">
                            <Key size={13} />
                          </button>
                        ) : (
                          <button onClick={() => resetPassword(u)} className="btn btn-ghost btn-sm !px-2" title="Reset password">
                            <LockIcon size={13} />
                          </button>
                        )}
                        {canHold && (
                          <button onClick={() => toggleHold(u)} className="btn btn-ghost btn-sm !px-2" title={u.isHeld ? "Re-enable" : "Suspend"}>
                            {u.isHeld ? <Play size={13} /> : <Pause size={13} />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Screen>

      {open && (
        <AddUser
          currentRole={user?.role}
          branchId={user?.branchId ?? null}
          onClose={() => setOpen(false)}
          onDone={() => { setOpen(false); setLoading(true); load(); toast.push("ok", "User created"); }}
        />
      )}

      {authOf && (
        <SetAuthModal
          user={authOf}
          onClose={() => setAuthOf(null)}
          onDone={() => { setAuthOf(null); setLoading(true); load(); toast.push("ok", "Sign-in method changed"); }}
        />
      )}
    </div>
  );
}

function SetAuthModal({ user, onClose, onDone }: { user: User; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [method, setMethod] = useState<"pin" | "password">(user.authMethod as "pin" | "password");
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
                {m === "pin" ? "Staff PIN" : "Username + password"}
              </button>
            ))}
          </div>
        </div>
        {method === "pin" ? (
          <div><label className="lbl">PIN (4-10 digits)</label>
            <input className="inp mono tracking-widest" type="password" inputMode="numeric" maxLength={10}
              value={pin} autoFocus onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
          </div>
        ) : (
          <>
            <div><label className="lbl">Username</label>
              <input className="inp" value={username} autoFocus onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div><label className="lbl">Temporary password (6+ chars)</label>
              <input className="inp" type="password" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} />
              <p className="text-[11px] text-muted mt-1">User will be asked to change it on next sign-in.</p>
            </div>
          </>
        )}
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">
          {busy ? "Saving…" : "Change sign-in method"}
        </button>
      </div>
    </Modal>
  );
}

function AddUser({
  currentRole, branchId, onClose, onDone,
}: {
  currentRole?: Role;
  branchId: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    name: "",
    role: "server",
    pin: "",
    payRate: "",
    payType: "hourly",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState("");

  const roles = currentRole === "manager"
    ? ["server", "cashier", "kitchen", "finance"]
    : ["server", "cashier", "kitchen", "finance", "manager", "superManager"];

  async function save() {
    if (!f.name.trim() || f.pin.length < 4) {
      setErr("Name and a 4+ digit PIN are required");
      return;
    }
    setBusy(true); setErr("");
    try {
      await apiPost("/users", {
        name: f.name,
        role: f.role,
        pin: f.pin,
        payRate: Number(f.payRate) || 0,
        payType: f.payType,
        branchId,
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  return (
    <Modal open title="New user" onClose={onClose} width={460}>
      <div className="space-y-3">
        <div><label className="lbl">Name</label>
          <input className="inp" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Role</label>
            <select className="inp" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>)}
            </select></div>
          <div><label className="lbl">PIN (4-10 digits)</label>
            <input className="inp mono tracking-widest" type="password" inputMode="numeric" maxLength={10}
              value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, "") })} /></div>
          <div><label className="lbl">Pay rate</label>
            <input className="inp mono" inputMode="decimal" value={f.payRate}
              onChange={(e) => setF({ ...f, payRate: e.target.value })} /></div>
          <div><label className="lbl">Pay type</label>
            <select className="inp" value={f.payType} onChange={(e) => setF({ ...f, payType: e.target.value })}>
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="salary">Salary</option>
            </select></div>
        </div>
        {err && (
          <div className="rounded-lg p-2 text-[12.5px] text-center" style={{ background: "var(--bad-wash)", color: "var(--bad)" }}>
            {err}
          </div>
        )}
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">
          {busy ? "Saving…" : "Create user"}
        </button>
      </div>
    </Modal>
  );
}
