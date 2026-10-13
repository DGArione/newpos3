"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Delete, ArrowRight, KeyRound } from "lucide-react";
import { api, SessionUser } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import { Wordmark, LogoMark } from "@/components/Logo";
import { Spinner } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const { login, user } = useAuth();
  const settings = useSettings();
  const [pin, setPin] = useState("");
  const [mode, setMode] = useState<"pin" | "password">("pin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (user) router.replace("/"); }, [user, router]);

  const press = (d: string) => { setError(""); setPin((p) => (p.length >= 8 ? p : p + d)); };
  const back = () => setPin((p) => p.slice(0, -1));

  async function submitPin() {
    if (pin.length < 3) { setError("Enter your PIN"); return; }
    setBusy(true); setError("");
    try {
      const u = await api<SessionUser>("/auth/login", { method: "POST", json: { pin }, noAuthRedirect: true });
      login(u);
      router.replace(u.role === "superManager" ? "/branches" : "/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
      setPin("");
    } finally { setBusy(false); }
  }

  async function submitPassword() {
    setBusy(true); setError("");
    try {
      const u = await api<SessionUser>("/auth/login-password", { method: "POST", json: { username, password }, noAuthRedirect: true });
      login(u);
      router.replace(u.role === "admin" ? "/settings" : "/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally { setBusy(false); }
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (mode !== "pin") return;
      if (e.key >= "0" && e.key <= "9") press(e.key);
      else if (e.key === "Backspace") back();
      else if (e.key === "Enter") submitPin();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pin]);

  return (
    <div
      className="min-h-screen grid md:grid-cols-[1.1fr_1fr]"
      style={{ background: "var(--paper)" }}
    >
      {/* Brand panel */}
      <div
        className="relative hidden md:flex flex-col justify-between p-12 text-white overflow-hidden"
        style={{ background: "linear-gradient(135deg, var(--olive) 0%, var(--olive-700) 100%)" }}
      >
        <div className="flex items-center gap-3 relative z-10">
          <div
            className="flex size-11 items-center justify-center rounded-2xl text-[16px] font-bold"
            style={{ background: "rgba(255,255,255,.18)", backdropFilter: "blur(8px)" }}
          >
            GB
          </div>
          <span className="font-semibold tracking-wider text-xs uppercase opacity-95">
            Golden Beach
          </span>
        </div>

        <div className="relative z-10">
          <h2 className="text-[42px] leading-[1.08] font-semibold">
            Good food,<br />
            <span style={{ color: "rgba(255,255,255,.75)" }}>golden hours.</span>
          </h2>
          <p className="mt-5 max-w-sm text-[14px] leading-relaxed opacity-85">
            {settings?.businessAddress || "Midigama, Sri Lanka"} &mdash; point of sale for the whole
            house: orders, kitchen, floor, payments and the books.
          </p>
        </div>

        <div className="text-xs opacity-70 tracking-wide relative z-10">
          {settings?.businessName || "Golden Beach Restaurant"} · v2.0
        </div>

        {/* decorative circles */}
        <div
          className="absolute -right-20 -top-20 h-72 w-72 rounded-full"
          style={{ background: "rgba(255,255,255,.08)" }}
          aria-hidden="true"
        />
        <div
          className="absolute -right-40 bottom-10 h-96 w-96 rounded-full"
          style={{ background: "rgba(255,255,255,.05)" }}
          aria-hidden="true"
        />
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="md:hidden mb-8 flex justify-center">
            <Wordmark />
          </div>

          <h1 className="text-[24px] font-semibold text-ink">Welcome back</h1>
          <p className="text-sm text-muted mt-1 mb-7">
            {mode === "pin"
              ? "Enter your staff PIN to clock in."
              : "Sign in with your username and password."}
          </p>

          {mode === "pin" ? (
            <>
              {/* PIN dots */}
              <div className="flex justify-center gap-2.5 mb-6 h-5">
                {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
                  <span
                    key={i}
                    className="w-3 h-3 rounded-full transition-colors"
                    style={{ background: i < pin.length ? "var(--olive)" : "var(--line)" }}
                  />
                ))}
              </div>

              {/* Keypad */}
              <div className="grid grid-cols-3 gap-2.5">
                {["1","2","3","4","5","6","7","8","9"].map((d) => (
                  <button
                    key={d}
                    onClick={() => press(d)}
                    className="py-4 text-xl font-semibold rounded-xl transition active:scale-95"
                    style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink)" }}
                  >
                    {d}
                  </button>
                ))}
                <button
                  onClick={back}
                  className="py-4 flex items-center justify-center rounded-xl transition active:scale-95"
                  style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--muted)" }}
                >
                  <Delete size={20} />
                </button>
                <button
                  onClick={() => press("0")}
                  className="py-4 text-xl font-semibold rounded-xl transition active:scale-95"
                  style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink)" }}
                >
                  0
                </button>
                <button
                  onClick={submitPin}
                  disabled={busy}
                  className="btn btn-primary rounded-xl text-white"
                  style={{ padding: 0 }}
                >
                  {busy ? <Spinner /> : <ArrowRight size={20} />}
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <label className="lbl">Username</label>
                <input
                  className="inp"
                  value={username}
                  autoFocus
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitPassword()}
                />
              </div>
              <div>
                <label className="lbl">Password</label>
                <input
                  className="inp"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitPassword()}
                />
              </div>
              <button onClick={submitPassword} disabled={busy} className="btn btn-primary btn-lg mt-1">
                {busy ? <Spinner /> : "Sign in"}
              </button>
            </div>
          )}

          {error && (
            <div
              className="mt-4 text-sm text-center rounded-lg py-2 px-3"
              style={{ background: "var(--bad-wash)", color: "var(--bad)" }}
            >
              {error}
            </div>
          )}

          <button
            onClick={() => { setMode((m) => (m === "pin" ? "password" : "pin")); setError(""); }}
            className="mt-7 w-full flex items-center justify-center gap-2 text-sm text-muted hover:text-ink transition"
          >
            <KeyRound size={15} />
            {mode === "pin" ? "Sign in with username & password" : "Use a staff PIN instead"}
          </button>
        </div>
      </div>
    </div>
  );
}
