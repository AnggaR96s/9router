// Guards the OAuth success confirmation, which was dead code in OAuthModal: the markup for
// the "Connected Successfully!" screen existed but was never visible. Every success path
// called `setStep("success")` and `onSuccess()` in the same tick, React batched both, and
// the caller's handler closed the modal (`setShowOAuthModal(false)`) before the
// confirmation could paint. The fix defers the handoff; these tests cover that deferral,
// because getting it wrong either hides the screen again or leaves the caller uninformed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSuccessHandoff } from "../../src/shared/utils/oauthSuccessHandoff.js";

describe("createSuccessHandoff: showing the OAuth success screen", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("notifies only after the pause, not in the same tick", () => {
    const handoff = createSuccessHandoff({ delayMs: 1500 });
    const onHandoff = vi.fn();

    handoff.begin(onHandoff);

    // The original bug: the caller was told synchronously, so the modal unmounted before
    // the confirmation rendered. The notification must not arrive yet.
    expect(onHandoff).not.toHaveBeenCalled();
    expect(handoff.isPending()).toBe(true);

    vi.advanceTimersByTime(1499);
    expect(onHandoff).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onHandoff).toHaveBeenCalledTimes(1);
    expect(handoff.isPending()).toBe(false);
  });

  it("still tells the caller when the user dismisses the screen early", () => {
    const handoff = createSuccessHandoff({ delayMs: 1500 });
    const onHandoff = vi.fn();

    handoff.begin(onHandoff);
    const committed = handoff.commitNow();

    expect(committed).toBe(true);
    expect(onHandoff).toHaveBeenCalledTimes(1);
    expect(handoff.isPending()).toBe(false);

    // The timer must be gone, not merely superseded.
    vi.advanceTimersByTime(5000);
    expect(onHandoff).toHaveBeenCalledTimes(1);
  });

  it("does not report success when nothing was pending", () => {
    // A plain Cancel during the flow goes through the same close path. If that path
    // reported success, the caller would refresh and could re-open the modal.
    const handoff = createSuccessHandoff({ delayMs: 1500 });
    expect(handoff.commitNow()).toBe(false);
  });

  it("never fires a late timer after the modal unmounts", () => {
    const handoff = createSuccessHandoff({ delayMs: 1500 });
    const onHandoff = vi.fn();

    handoff.begin(onHandoff);
    handoff.cancel(); // unmount / modal closed without success

    vi.advanceTimersByTime(10000);
    expect(onHandoff).not.toHaveBeenCalled();
    expect(handoff.isPending()).toBe(false);
  });

  it("gives a re-entered flow its own full pause, not the leftover one", () => {
    const handoff = createSuccessHandoff({ delayMs: 1500 });
    const first = vi.fn();
    const second = vi.fn();

    handoff.begin(first);
    vi.advanceTimersByTime(1000); // 1000ms into the first pause
    handoff.begin(second);        // flow re-entered; second gets its own 1500ms

    // Both timers would deliver the same latest handler, so counting calls cannot tell
    // them apart — assert the timing instead. The stale timer would fire at 1500ms, only
    // 500ms into the second pause, and hand off early.
    vi.advanceTimersByTime(1000); // t=2000: 1000ms elapsed, 500ms still owed
    expect(second).not.toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500); // t=2500: the second pause completes
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("defaults to a pause long enough to read (iFlow uses 1500ms)", () => {
    const handoff = createSuccessHandoff();
    const onHandoff = vi.fn();
    handoff.begin(onHandoff);

    vi.advanceTimersByTime(1000);
    expect(onHandoff).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onHandoff).toHaveBeenCalledTimes(1);
  });

  it("tolerates a missing callback instead of throwing", () => {
    const handoff = createSuccessHandoff({ delayMs: 10 });
    handoff.begin(undefined);
    expect(() => vi.advanceTimersByTime(10)).not.toThrow();
    expect(handoff.isPending()).toBe(false);
  });
});