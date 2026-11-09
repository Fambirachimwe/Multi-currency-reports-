import { useState } from 'react';
import { CurrencyTag } from '@/components/currency-tag';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatAmount, formatQuantity } from '@/lib/format';

const VISIBLE_GROUPS = 50;

/** One grouping table. Rows are per currency and never added across currencies. */
export function GroupTable({ caption, idLabel, groups }) {
  const [showAll, setShowAll] = useState(false);
  if (groups.length === 0) return null;
  const visible = showAll ? groups : groups.slice(0, VISIBLE_GROUPS);
  return (
    <div className="flex flex-col gap-2">
      <Table containerClassName="rounded-md border">
        <TableCaption>{caption}</TableCaption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Currency</TableHead>
            <TableHead>{idLabel}</TableHead>
            <TableHead className="text-right">Lines</TableHead>
            <TableHead className="text-right">Quantity</TableHead>
            <TableHead className="text-right">Turnover</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((group) => (
            <TableRow key={`${group.currency}/${group.id}`}>
              <TableCell>
                <CurrencyTag currency={group.currency} />
              </TableCell>
              <TableCell>
                <span className="font-medium">{group.name ?? group.id}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{group.lineCount}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatQuantity(group.quantity)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatAmount(group.turnover)} {group.currency}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {groups.length > VISIBLE_GROUPS ? (
        <div>
          <Button type="button" size="sm" variant="outline" onClick={() => setShowAll((v) => !v)}>
            {showAll ? `Show first ${VISIBLE_GROUPS}` : `Show all ${groups.length}`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
