import { IntentLink as Link } from "@/components/common/intent-link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface ResultRow {
  id: string;
  name: string;
  /** id is null for roster players entered by game ID without an account. */
  players: { id: string | null; name: string }[];
  placement: number | null;
  kills: number | null;
  won: boolean | null;
  roundDiff: number | null;
  points: number;
}

export function ResultsTable({ rows, battleRoyale }: { rows: ResultRow[]; battleRoyale: boolean }) {
  if (!rows.length) return <p className="text-muted-foreground text-sm">No results posted.</p>;
  return (
    <div className="card-ds overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{battleRoyale ? "#" : "Result"}</TableHead>
            <TableHead>Player / team</TableHead>
            {battleRoyale ? (
              <TableHead className="text-right">Kills</TableHead>
            ) : (
              <TableHead className="text-right">Round diff</TableHead>
            )}
            <TableHead className="text-right">Points</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-semibold">
                {battleRoyale ? r.placement : r.won ? "Win" : "Loss"}
              </TableCell>
              <TableCell>
                <p className="font-medium">{r.name}</p>
                {r.players.length > 1 ? (
                  <p className="text-muted-foreground text-xs">
                    {r.players.map((p, i) => (
                      <span key={p.id ?? `${p.name}-${i}`}>
                        {i ? ", " : ""}
                        {p.id ? (
                          <Link href={`/players/${p.id}`} className="hover:underline">
                            {p.name}
                          </Link>
                        ) : (
                          p.name
                        )}
                      </span>
                    ))}
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="text-right">
                {battleRoyale ? r.kills : (r.roundDiff ?? 0)}
              </TableCell>
              <TableCell className="text-right font-semibold">{r.points}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
