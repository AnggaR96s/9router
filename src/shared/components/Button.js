"use client";

import { cn } from "@/shared/utils/cn";

// A disabled control is still read, so it dims through its TEXT, not through a
// blanket opacity: `disabled:opacity-50` composited the label AND its own fill
// against the ancestor, and on the neubrutalist/pinkneon looks the theme rules
// keyed on `.bg-brand-500` forced the theme ink onto that fill anyway — measured
// 1.25:1-3.51:1 across the six theme combinations. `--color-text-disabled` is the
// weakest step of each palette that still clears 4.5:1 on the muted surfaces.
const variants = {
  primary: "bg-brand-500 hover:bg-brand-600 text-white shadow-sm disabled:bg-surface-3 disabled:text-text-disabled",
  secondary: "bg-surface-2 hover:bg-surface-3 text-text-main border border-border disabled:text-text-disabled",
  outline: "border border-border text-text-main hover:bg-surface-2 hover:border-brand-500/40 disabled:text-text-disabled",
  ghost: "text-text-muted hover:bg-surface-2 hover:text-text-main disabled:text-text-disabled",
  danger: "bg-red-500 hover:bg-red-600 text-white shadow-sm disabled:bg-surface-3 disabled:text-text-disabled",
  success: "bg-green-600 hover:bg-green-700 text-white shadow-sm disabled:bg-surface-3 disabled:text-text-disabled",
};

const sizes = {
  sm: "h-7 px-3 text-xs rounded-[8px]",
  md: "h-9 px-4 text-sm rounded-[10px]",
  lg: "h-11 px-6 text-sm rounded-[10px]",
  // No fixed height: the button stretches to the row's height, so it stays
  // exactly as tall as a sibling Input (whose height varies per theme because
  // the look overrides its border width — 42px default vs 44px neubrutalist).
  stretch: "h-auto px-4 text-sm rounded-[10px]",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  disabled = false,
  loading = false,
  fullWidth = false,
  className,
  ...props
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap transition-all duration-150 ease-out cursor-pointer",
        "active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
      ) : icon ? (
        <span className="material-symbols-outlined text-[18px]">{icon}</span>
      ) : null}
      {children}
      {iconRight && !loading && (
        <span className="material-symbols-outlined text-[18px]">{iconRight}</span>
      )}
    </button>
  );
}
