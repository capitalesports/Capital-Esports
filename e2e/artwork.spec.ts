import { expect, test, type Page } from "@playwright/test";

/**
 * Design artwork (docs/design/assets → public/art via scripts/sync-art.mjs) renders the real files:
 * no placeholders, transparent art without a box, hero characters placed like home-desktop.png,
 * card art on the right 40%, and nothing over 300 KB on a phone.
 */
const PAGES = ["/", "/scrims", "/games/free-fire", "/tournament/bgmi", "/leaderboard/valorant"];
const TRANSPARENT = /^(hero-|empty-|trophy-podium)/;
const MAX_IMAGE_BYTES = 300 * 1024;

/**
 * Load every artwork image, including lazy ones in sideways rows that never enter the viewport, and wait
 * for them. Switching to eager loading doesn't change which srcset variant the browser picks.
 */
async function loadAllArt(page: Page) {
  await page.evaluate(() => document.querySelectorAll<HTMLImageElement>("img[data-artwork]").forEach((img) => (img.loading = "eager")));
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>("img[data-artwork]")].every((i) => i.complete));
}

test("every artwork renders its real file, and transparent art has no box behind it", async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    await loadAllArt(page);
    await expect(page.locator("[data-artwork-placeholder]"), path).toHaveCount(0);
    const art = await page.locator("img[data-artwork]").evaluateAll((imgs) =>
      (imgs as HTMLImageElement[]).map((img) => {
        const box = (el: Element | null) => {
          const s = el ? getComputedStyle(el) : null;
          return s ? { bg: s.backgroundColor, bgImage: s.backgroundImage, border: s.borderTopWidth } : null;
        };
        // Only a wrapper that exists just for this image counts (not e.g. the hero panel card it sits in).
        const parent = img.closest("picture")?.parentElement ?? null;
        const wrapper = parent && parent.children.length === 1 ? parent : null;
        return { name: img.dataset.artwork!, loaded: img.naturalWidth > 0, src: img.currentSrc, img: box(img), parent: box(wrapper) };
      }),
    );
    expect(art.length, `${path}: artwork on the page`).toBeGreaterThan(0);
    for (const a of art) {
      expect(a.loaded, `${path} ${a.name} loaded`).toBe(true);
      expect(a.src, `${path} ${a.name} served as WebP`).toMatch(/\.webp$/);
      if (TRANSPARENT.test(a.name)) {
        expect(a.img!.bg, `${path} ${a.name}: no background on the image`).toBe("rgba(0, 0, 0, 0)");
        if (a.parent) {
          expect(a.parent.bg, `${path} ${a.name}: no background box around it`).toBe("rgba(0, 0, 0, 0)");
          expect(a.parent.border, `${path} ${a.name}: no border box around it`).toBe("0px");
        }
      }
    }
  }
});

test.describe("placement on desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  test("hero characters: head at the top, feet cut by the panel's bottom edge", async ({ page }) => {
    await page.goto("/");
    const heroes = await page.locator('img[data-artwork^="hero-"]').evaluateAll((imgs) =>
      (imgs as HTMLImageElement[]).map((img) => {
        const r = img.getBoundingClientRect();
        const scaledHeight = r.width * (img.naturalHeight / img.naturalWidth); // object-fit: cover, width-bound
        return { name: img.dataset.artwork, position: getComputedStyle(img).objectPosition, fit: getComputedStyle(img).objectFit, scaledHeight, boxHeight: r.height };
      }),
    );
    expect(heroes.map((h) => h.name).sort()).toEqual(["hero-bgmi", "hero-freefire", "hero-valorant"]);
    for (const h of heroes) {
      expect(h.fit, h.name).toBe("cover");
      expect(h.position, `${h.name}: pinned to the top so the head is never cut`).toBe("50% 0%");
      expect(h.scaledHeight, `${h.name}: taller than the panel, so the legs run off the bottom edge`).toBeGreaterThan(h.boxHeight * 1.1);
    }
  });

  test("card art sits on the right 40% of match and tournament cards, text stays on the left", async ({ page }) => {
    for (const [path, cardSel, artPrefix, textSel] of [
      ["/scrims", "article", "card-match-", "h3"],
      ["/", 'article[aria-label$="weekly tournament"]', "card-tournament-", "p"],
    ] as const) {
      await page.goto(path);
      await loadAllArt(page);
      const cards = await page.locator(cardSel).evaluateAll(
        (els, [prefix, textSel]) =>
          els
            .map((card) => {
              const img = card.querySelector<HTMLImageElement>(`img[data-artwork^="${prefix}"]`);
              if (!img) return null;
              const c = card.getBoundingClientRect();
              const a = img.getBoundingClientRect();
              const t = card.querySelector(textSel)!.getBoundingClientRect();
              return { share: a.width / c.width, rightGap: Math.abs(c.right - a.right), textEnd: (t.right - c.left) / c.width, position: getComputedStyle(img).objectPosition };
            })
            .filter(Boolean),
        [artPrefix, textSel],
      );
      expect(cards.length, path).toBeGreaterThan(0);
      for (const c of cards) {
        expect(c!.share, `${path}: art width share`).toBeGreaterThan(0.38);
        expect(c!.share, `${path}: art width share`).toBeLessThan(0.42);
        expect(c!.rightGap, `${path}: art flush right`).toBeLessThan(2);
        expect(c!.position, `${path}: subject anchored right`).toBe("100% 50%");
        expect(c!.textEnd, `${path}: text column stays in the left 60%`).toBeLessThanOrEqual(0.62);
      }
    }
  });
});

test("no single image is over 300 KB on a phone (WebP variants chosen by srcset)", async ({ page }) => {
  const images: { url: string; bytes: number }[] = [];
  page.on("response", async (res) => {
    if (res.request().resourceType() !== "image" || !res.ok()) return;
    const body = await res.body().catch(() => null);
    if (body) images.push({ url: new URL(res.url()).pathname, bytes: body.length });
  });
  for (const path of PAGES) {
    await page.goto(path);
    await loadAllArt(page);
  }
  const art = images.filter((i) => i.url.startsWith("/art/"));
  expect(art.length).toBeGreaterThan(10);
  const heavy = images.filter((i) => i.bytes > MAX_IMAGE_BYTES).map((i) => `${i.url} ${Math.round(i.bytes / 1024)} KB`);
  expect(heavy).toEqual([]);
  expect(art.filter((i) => i.url.endsWith(".png")).map((i) => i.url), "phones get WebP, not the PNG fallback").toEqual([]);
});
