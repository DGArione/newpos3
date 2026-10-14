"use client";

import { useState } from "react";
import { UserCog, Key, Lock, ShieldCheck, Save } from "lucide-react";
import { apiPost, apiPut } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, Screen, useToast } from "@/components/ui";

export default function ProfilePage() {
  const toast = useToast();
  const { user } = useAuth();
  const [name, setName]           = useState(user?.name || "");
  const [pin, setPin]             = useState("");
  const [password, setPassword]   = useState("");
  const [approvalPin, setApprovalPin] = useState("");
  const [busy, setBusy]           = useState(false);

  if (!user) return null;

  const canApprove = user.role === "manager" || user.role === "superManager" || user.role === "admin";
  const authIsPassword = user.authMethod === "password";

  async function saveName() {
    if (!name.trim()) { toast.push("bad", "Name required"); return; }
    setBusy(true);
    try { await apiPut("/me", { name }); toast.push("ok", "Name updated"); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }
  async function savePin() {
    if (pin.length < 4) { toast.push("bad", "PIN must be at least 4 digits"); return; }
    setBusy(true);
    try { await apiPost("/me/login-pin", { pin }); setPin(""); toast.push("ok", "PIN changed"); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }
  async function savePassword() {
    if (password.length < 6) { toast.push("bad", "At least 6 characters"); return; }
    setBusy(true);
    try { await apiPost("/auth/change-password", { newPassword: password }); setPassword(""); toast.push("ok", "Password changed"); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }
  async function saveApprovalPin() {
    setBusy(true);
    try {
      await apiPost("/me/approval-pin", { approvalPin });
      setApprovalPin("");
      toast.push("ok", approvalPin ? "Approval PIN set" : "Approval PIN cleared");
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      <Screen>
        <PageHeader title="My profile" subtitle={`Signed in as ${user.name} (${user.role})`} icon={UserCog} />

        <div className="flex items-center gap-4 mb-5">
          <span
            className="flex size-16 shrink-0 items-center justify-center rounded-2xl text-white text-[22px] font-bold"
            style={{ background: "var(--olive)" }}
          >
            {user.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <label className="lbl">Display name</label>
            <div className="flex gap-2">
              <input className="inp flex-1" value={name} onChange={(e) => setName(e.target.value)} />
              <button onClick={saveName} disabled={busy} className="btn btn-primary">
                <Save size={14} /> Save
              </button>
            </div>
          </div>
        </div>
      </Screen>

      {/* ---- Change sign-in credential ---- */}
      <Screen>
        <h2 className="text-[15px] font-semibold text-ink mb-4 flex items-center gap-2">
          {authIsPassword ? <Lock size={16} /> : <Key size={16} />}
          {authIsPassword ? "Change password" : "Change PIN"}
        </h2>

        {authIsPassword ? (
          <div className="flex gap-2 max-w-sm">
            <input
              type="password"
              className="inp"
              placeholder="New password (6+ chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button onClick={savePassword} disabled={busy || password.length < 6} className="btn btn-primary">
              Change
            </button>
          </div>
        ) : (
          <div className="flex gap-2 max-w-sm">
            <input
              type="password"
              inputMode="numeric"
              maxLength={10}
              className="inp mono tracking-widest"
              placeholder="New PIN (4-10 digits)"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
            <button onClick={savePin} disabled={busy || pin.length < 4} className="btn btn-primary">
              Change
            </button>
          </div>
        )}
      </Screen>

      {/* ---- Approval PIN (managers only) ---- */}
      {canApprove && (
        <Screen>
          <h2 className="text-[15px] font-semibold text-ink mb-2 flex items-center gap-2">
            <ShieldCheck size={16} style={{ color: "var(--olive)" }} /> Approval PIN
          </h2>
          <p className="text-[12.5px] text-muted mb-3">
            A separate PIN managers use to authorise discounts, voids and refunds.
            Must be different from your sign-in PIN. Leave blank and press save to clear.
          </p>
          <div className="flex gap-2 max-w-sm">
            <input
              type="password"
              inputMode="numeric"
              maxLength={10}
              className="inp mono tracking-widest"
              placeholder="Approval PIN"
              value={approvalPin}
              onChange={(e) => setApprovalPin(e.target.value.replace(/\D/g, ""))}
            />
            <button onClick={saveApprovalPin} disabled={busy} className="btn btn-primary">
              Save
            </button>
          </div>
        </Screen>
      )}
    </div>
  );
}
