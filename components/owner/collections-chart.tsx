'use client';

import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { formatTZS } from '@/lib/money/format';
import type { CollectionsPoint } from '@/lib/dashboard/queries';

const chartConfig = {
  collected: {
    label: 'Collected',
    color: 'var(--chart-1)',
  },
} satisfies ChartConfig;

// Deterministic on server and client (fixed timezone) — no hydration drift.
const dayLabel = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  timeZone: 'Africa/Dar_es_Salaam',
});

function labelFor(date: string): string {
  return dayLabel.format(new Date(`${date}T12:00:00+03:00`));
}

export function CollectionsChart({ data }: { data: CollectionsPoint[] }) {
  const total = data.reduce((s, d) => s + d.collected, 0);

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Collections — last 14 days</CardTitle>
        <CardDescription>
          {formatTZS(total)} collected in total (cash + mobile money)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[220px] w-full">
          <AreaChart data={data} margin={{ left: 4, right: 4 }}>
            <defs>
              <linearGradient id="fillCollected" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-collected)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="var(--color-collected)" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              tickFormatter={(value: string) => labelFor(value)}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => labelFor(String(value))}
                  formatter={(value) => (
                    <span className="font-mono font-medium tabular-nums">
                      {formatTZS(Number(value))}
                    </span>
                  )}
                />
              }
            />
            <Area
              dataKey="collected"
              type="monotone"
              fill="url(#fillCollected)"
              stroke="var(--color-collected)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
