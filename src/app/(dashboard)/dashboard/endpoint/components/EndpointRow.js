"use client";

import { Input } from "@/shared/components";

/** Reusable endpoint row component */
export default function EndpointRow({ label, url, copyId, copied, onCopy, badge, actions }) {
  return (
    // min-w-0 on the row and the input: without it, a long relay URL keeps its
    // intrinsic width, pushes the copy button out of the row and makes the page
    // scroll sideways. Measured at 320px: the input's right edge landed 3px past
    // the row's. The flex-1 input needs min-w-0 to be allowed to shrink at all
    // (a flex item's default min-width is auto = content width), and `truncate`
    // on the inner input gives long URLs an ellipsis instead of a clipped edge.
    <div className="flex min-w-0 items-center gap-2">
      <span className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 min-w-[88px] text-center ${
          (badge === "CF" || badge === "TS") ? "bg-primary/10 text-primary" : "bg-surface-2 text-text-muted"
        }`}>{label}</span>
      <Input value={url} readOnly className="flex-1 min-w-0 font-mono text-sm" inputClassName="truncate" />
      <button
        onClick={() => onCopy(url, copyId)}
        className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors shrink-0"
      >
        <span className="material-symbols-outlined text-[18px]">{copied === copyId ? "check" : "content_copy"}</span>
      </button>
      {actions}
    </div>
  );
}
