import {
  CalendarDaysIcon,
  GiftIcon,
  ShieldCheckIcon,
  UsersIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";

interface Reason {
  icon: LucideIcon;
  title: string;
  body: string;
}

const FAIR: Reason = {
  icon: ShieldCheckIcon,
  title: "Fair & Secure",
  body: "Verified players, moderated results",
};
const REWARDS: Reason = {
  icon: GiftIcon,
  title: "Real Rewards",
  body: "Win real prizes and recognition",
};
const COMMUNITY: Reason = {
  icon: UsersIcon,
  title: "Active Community",
  body: "Squads, Discord and WhatsApp updates",
};

/** Home: "Why Play on Our Platform?" (home-desktop.png). */
const HOME_REASONS = [
  FAIR,
  { icon: CalendarDaysIcon, title: "Regular Tournaments", body: "Daily scrims & weekly events" },
  REWARDS,
  COMMUNITY,
];
/** Scrims page trust row (scrims-desktop.png). */
const SCRIMS_REASONS = [
  FAIR,
  REWARDS,
  { icon: CalendarDaysIcon, title: "Regular Scrims", body: "Daily scrims across all games" },
  COMMUNITY,
];

function ReasonItem({ r }: { r: Reason }) {
  return (
    <li className="lg:border-border flex items-center gap-3 lg:border-l lg:px-6 lg:first:border-l-0">
      <r.icon aria-hidden className="text-gold size-8 shrink-0" />
      <div>
        <h3 className="font-sans text-sm font-semibold">{r.title}</h3>
        <p className="text-muted-foreground text-xs">{r.body}</p>
      </div>
    </li>
  );
}

/** "Why Play on Our Platform?" row from home-desktop.png. */
export function WhyPlay() {
  return (
    <section
      aria-labelledby="why-heading"
      className="card-ds grid gap-5 p-5 lg:grid-cols-[auto_1fr] lg:items-center lg:gap-0 lg:p-4"
    >
      <div className="flex items-center gap-3 lg:pr-6">
        <ZapIcon aria-hidden className="fill-gold text-gold size-8" />
        <h2 id="why-heading" className="text-2xl font-bold">
          Why Play on Our Platform?
        </h2>
      </div>
      <ul className="lg:border-border grid gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0 lg:border-l">
        {HOME_REASONS.map((r) => (
          <ReasonItem key={r.title} r={r} />
        ))}
      </ul>
    </section>
  );
}

/** The scrims page's trust row: the same four-up strip without a heading. */
export function TrustRow() {
  return (
    <section aria-label="Why play here" className="card-ds p-5 lg:p-4">
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
        {SCRIMS_REASONS.map((r) => (
          <ReasonItem key={r.title} r={r} />
        ))}
      </ul>
    </section>
  );
}
