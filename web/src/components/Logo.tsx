export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-2xl text-white font-bold"
      style={{
        width: size,
        height: size,
        background: "var(--olive)",
        fontSize: size * 0.42,
        letterSpacing: "-0.02em",
      }}
      aria-hidden="true"
    >
      GB
    </div>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={compact ? 32 : 40} />
      {!compact && (
        <div className="leading-tight">
          <div className="text-[15px] font-semibold text-ink">Golden Beach</div>
          <div className="text-[10px] font-semibold tracking-wider text-muted uppercase mt-0.5">
            Restaurant · POS
          </div>
        </div>
      )}
    </div>
  );
}
