/**
 * Success-screen handoff for the OAuth modals.
 *
 * The confirmation screen ("Connected Successfully!") existed in `OAuthModal`'s markup but
 * was never seen, because every success path called `setStep("success")` and `onSuccess()`
 * in the same tick. React batches both updates, and the caller's `onSuccess` handler
 * (`handleOAuthSuccess` in the provider page) calls `setShowOAuthModal(false)`, so the
 * modal unmounted before the confirmation could paint.
 *
 * The handoff therefore has to be two phases: render the confirmation first, then tell the
 * caller a moment later. That logic lives here rather than inline in the component so it
 * can be exercised without a DOM — this repo's suite runs in a plain node environment.
 *
 * The subtle parts, each covered by a test:
 * - the caller is notified exactly once, whether the pause elapses or the user dismisses
 *   the screen first;
 * - a dismissal must NOT swallow the notification, or the caller never refreshes its
 *   connection list and can leave the newly linked account invisible;
 * - a late timer must not fire into an unmounted component;
 * - re-entering the flow must not leave a stale timer behind.
 */

/**
 * @param {number} delayMs  How long the confirmation stays up before the automatic handoff.
 */
export function createSuccessHandoff({ delayMs = 1500 } = {}) {
  let timer = null;
  let pending = false;
  let handler = null;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const deliver = () => {
    const fn = handler;
    handler = null;
    pending = false;
    timer = null;
    fn?.();
  };

  return {
    /**
     * Enter the confirmation phase: `onHandoff` runs after `delayMs`. Calling `begin` while
     * a handoff is already scheduled replaces it, so only the latest one can fire.
     */
    begin(onHandoff) {
      clear();
      handler = onHandoff;
      pending = true;
      timer = setTimeout(deliver, delayMs);
    },

    /**
     * Hand off immediately, for a user who dismisses the confirmation before the pause
     * elapses. Returns true when a pending handoff was delivered — false when there was
     * none, so a plain "Cancel" during the flow does not falsely report success.
     */
    commitNow() {
      if (!pending) return false;
      clear();
      deliver();
      return true;
    },

    /** Abandon the handoff without notifying — the flow did not actually succeed. */
    cancel() {
      clear();
      pending = false;
      handler = null;
    },

    /** True while the confirmation is up and the caller has not been notified yet. */
    isPending() {
      return pending;
    },
  };
}