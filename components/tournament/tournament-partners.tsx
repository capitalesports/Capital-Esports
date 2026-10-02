export interface TournamentPartner {
  id: string;
  name: string;
  logoUrl: string;
  url: string | null;
}

/** Small "Partners" row on the tournament page: admin-uploaded sponsor logos only. */
export function TournamentPartners({ partners }: { partners: TournamentPartner[] }) {
  if (!partners.length) return null;
  return (
    <section aria-labelledby="t-partners-h" className="card-ds space-y-3 p-4">
      <h2 id="t-partners-h" className="text-base font-bold">
        Partners
      </h2>
      <ul className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {partners.map((p) => {
          const logo = (
            // eslint-disable-next-line @next/next/no-img-element -- admin-uploaded logos from our storage
            <img
              src={p.logoUrl}
              alt={p.name}
              loading="lazy"
              className="h-7 w-auto max-w-28 object-contain opacity-90 hover:opacity-100"
            />
          );
          return (
            <li key={p.id}>
              {p.url ? (
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer sponsored"
                  className="min-h-tap inline-flex items-center"
                >
                  {logo}
                </a>
              ) : (
                logo
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
