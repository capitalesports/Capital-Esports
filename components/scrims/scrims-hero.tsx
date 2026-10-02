import { PlayIcon } from "lucide-react";
import { Artwork } from "@/components/common/artwork";
import { Button } from "@/components/ui/button";

/**
 * Full-width dark banner from scrims-desktop.png: "SCRIMS", the subline, and a "How scrims work?" card.
 * `hero-freefire` sits on the left, `hero-valorant` in the card on the right. "Watch Video" appears only
 * when an admin has set the video link (Admin → Content → "Scrims page — How scrims work video").
 */
export function ScrimsHero({ videoUrl }: { videoUrl: string | null }) {
  return (
    <section
      aria-labelledby="scrims-title"
      className="border-border bg-background relative isolate mx-[calc(50%-50vw)] w-screen overflow-hidden border-b"
    >
      <div aria-hidden className="absolute top-2 bottom-0 left-0 -z-10 w-2/5 max-w-md sm:w-1/3">
        <Artwork
          name="hero-freefire"
          placeholderBorder={false}
          priority
          sizes="(min-width: 640px) 33vw, 40vw"
          className="object-top"
        />
        <span className="via-background/40 to-background absolute inset-0 bg-gradient-to-r from-transparent" />
      </div>
      <div className="page-container flex min-h-44 flex-col justify-center gap-5 py-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="sm:pl-[12%] lg:pl-40">
          <h1
            id="scrims-title"
            className="font-heading text-6xl leading-none font-extrabold tracking-wide uppercase sm:text-7xl"
          >
            Scrims
          </h1>
          <p className="text-foreground mt-2 text-sm sm:text-base">
            Play Daily Scrims · Improve Skills · Win Real Rewards
          </p>
        </div>
        <aside
          aria-labelledby="how-scrims"
          className="card-ds relative isolate flex max-w-md items-center gap-4 overflow-hidden p-3 pr-5"
        >
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg">
            <Artwork name="hero-valorant" sizes="96px" lowPriority className="object-top" />
          </div>
          <div className="min-w-0">
            <h2 id="how-scrims" className="font-heading text-lg leading-tight font-bold uppercase">
              How scrims work?
            </h2>
            <p className="text-muted-foreground text-xs">Quick guide to join and play</p>
            {videoUrl ? (
              <Button asChild variant="outline" size="sm" className="mt-2">
                <a href={videoUrl} target="_blank" rel="noopener noreferrer">
                  <PlayIcon aria-hidden className="fill-current" /> Watch Video
                </a>
              </Button>
            ) : null}
          </div>
        </aside>
      </div>
    </section>
  );
}
