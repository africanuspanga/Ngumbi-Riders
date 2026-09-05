'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from '@/components/ui/chart';
import { formatTZS } from '@/lib/money/format';
import type { RiderBalancePoint } from '@/lib/dashboard/queries';

/*
 * "The dashboard should have a bar graph where one bar contains two colours:
 *  GREEN = amount currently due/outstanding up to that date, RED = total
 *  remaining balance required to complete the contract."
 *
 * One STACKED bar per rider. The two segments add up to the whole remaining
 * balance, so the bar's full length is "everything left to pay" and the green
 * part of it is "and this much is already owed" — which is how the owner reads
 * it at a glance without comparing two separate bars.
 *
 * Laid out HORIZONTALLY: rider names are long, and on a phone (this fleet runs
 * on low-cost Android) vertical bars would either clip the labels or force a
 * horizontal scroll. Height grows with the number of riders instead.
 */
const chartConfig = {
  outstandingNow: { label: 'Owed now', color: 'var(--color-paid)' },
  remainingLater: { label: 'Remaining on contract', color: 'var(--color-overdue)' },
} satisfies ChartConfig;

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export function BalanceChart({
  points,
  totalOutstandingNow,
  totalRemaining,
  riderCount,
}: {
  points: RiderBalancePoint[];
  totalOutstandingNow: number;
  totalRemaining: number;
  riderCount: number;
}) {
  if (points.length === 0) {
    return (
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Outstanding vs remaining balance</CardTitle>
          <CardDescription>Nothing outstanding — every contract is settled. ✓</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const data = points.map((p) => ({
    name: p.name.split(' ')[0] ?? p.name,
    fullName: p.name,
    outstandingNow: p.outstandingNow,
    remainingLater: p.remainingLater,
  }));

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Outstanding vs remaining balance</CardTitle>
        <CardDescription>
          <span className="font-semibold text-[color:var(--color-paid)]">
            {formatTZS(totalOutstandingNow)} owed now
          </span>{' '}
          ·{' '}
          <span className="font-semibold text-[color:var(--color-overdue)]">
            {formatTZS(totalRemaining)} to finish all contracts
          </span>
          {riderCount > points.length ? ` · showing the top ${points.length} of ${riderCount} riders` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={chartConfig}
          className="w-full"
          style={{ height: `${Math.max(180, data.length * 34 + 60)}px` }}
        >
          <BarChart data={data} layout="vertical" margin={{ left: 4, right: 12 }}>
            <CartesianGrid horizontal={false} />
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => compact.format(v)}
            />
            <YAxis
              type="category"
              dataKey="name"
              tickLine={false}
              axisLine={false}
              width={72}
              tickMargin={4}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(_label, payload) =>
                    (payload?.[0]?.payload as { fullName?: string } | undefined)?.fullName ?? ''
                  }
                  formatter={(value, name) => (
                    <span className="flex w-full items-center justify-between gap-3">
                      <span className="text-muted-foreground">
                        {chartConfig[name as keyof typeof chartConfig]?.label ?? name}
                      </span>
                      <span className="font-mono font-medium tabular-nums">
                        {formatTZS(Number(value))}
                      </span>
                    </span>
                  )}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar
              dataKey="outstandingNow"
              stackId="balance"
              fill="var(--color-outstandingNow)"
              radius={[4, 0, 0, 4]}
            />
            <Bar
              dataKey="remainingLater"
              stackId="balance"
              fill="var(--color-remainingLater)"
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
