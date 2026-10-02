import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatIST } from "@/lib/time";

export interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  createdAt: Date;
  actor: { displayName: string | null } | null;
}

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined)
    return <span className="text-muted-foreground">—</span>;
  return (
    <details>
      <summary className="text-muted-foreground cursor-pointer text-xs">view</summary>
      <pre className="bg-muted mt-1 max-w-md overflow-x-auto rounded p-2 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">No audit entries.</p>;
  return (
    <div className="card-ds overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When (IST)</TableHead>
            <TableHead>Who</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Before</TableHead>
            <TableHead>After</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap">{formatIST(r.createdAt)}</TableCell>
              <TableCell>{r.actor ? (r.actor.displayName ?? "(no name)") : "System"}</TableCell>
              <TableCell>
                <code className="text-xs">{r.action}</code>
              </TableCell>
              <TableCell className="text-xs">
                {r.entityType} <code>{r.entityId.slice(0, 10)}</code>
              </TableCell>
              <TableCell>
                <Json value={r.before} />
              </TableCell>
              <TableCell>
                <Json value={r.after} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
