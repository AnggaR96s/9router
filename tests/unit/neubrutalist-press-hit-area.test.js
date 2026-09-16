import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

/** Ambil badan aturan CSS berdasarkan selector persis (tanpa regex liar). */
function ruleBodies(selectorNeedle) {
  const out = [];
  let idx = 0;
  while (true) {
    const at = css.indexOf(selectorNeedle, idx);
    if (at === -1) break;
    const open = css.indexOf("{", at);
    const close = css.indexOf("}", open);
    out.push(css.slice(open + 1, close));
    idx = close + 1;
  }
  return out;
}

describe("neubrutalist press state must not move the hit area", () => {
  const bodies = ruleBodies('[data-visual="neubrutalist"] button:not(:disabled):active');

  it("aturan tekan ada", () => {
    expect(bodies.length).toBeGreaterThan(0);
  });

  it("tidak menggeser kotak (transform) saat ditekan", () => {
    // Kalau kotaknya bergeser, area klik ikut bergeser: tekanan yang jatuh dekat
    // tepi kiri/atas akan lepas di luar tombol, sehingga event click tidak pernah
    // lahir dan tombol terasa perlu diklik dua kali.
    for (const body of bodies) {
      expect(body).not.toMatch(/transform\s*:/);
      expect(body).not.toMatch(/translate/);
    }
  });

  it("tetap memberi umpan balik tekan lewat bayangan", () => {
    expect(bodies.some((b) => /box-shadow\s*:\s*none/.test(b))).toBe(true);
  });

  it("tidak ada aturan :active lain di tema nb yang menggeser kotak", () => {
    const activeRules = css.match(/\[[^\]]*neubrutalist[^\]]*\][^{]*:active[^{]*\{[^}]*\}/g) || [];
    expect(activeRules.length).toBeGreaterThan(0);
    for (const rule of activeRules) {
      expect(rule).not.toMatch(/transform\s*:/);
      expect(rule).not.toMatch(/translate\(/);
    }
  });
});
