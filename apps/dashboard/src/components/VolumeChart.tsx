import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface DayPoint {
  date: string;
  volumeMinor: string;
}

/** Plots whole rupees. This number is for drawing only: every printed amount uses formatInr. */
export function VolumeChart({ days }: { days: readonly DayPoint[] }) {
  const data = days.map((day) => ({
    label: day.date.slice(5),
    rupees: Number(BigInt(day.volumeMinor) / 100n),
  }));

  return (
    <div
      role="img"
      aria-label="Settled transfer volume per day for the last 7 days"
      className="h-56 w-full text-neutral-600 dark:text-neutral-400"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <XAxis dataKey="label" tick={{ fill: "currentColor", fontSize: 12 }} />
          <YAxis
            width={64}
            tick={{ fill: "currentColor", fontSize: 12 }}
            tickFormatter={(value: number) => `₹${value.toLocaleString("en-IN")}`}
          />
          <Tooltip formatter={(value) => `₹${Number(value).toLocaleString("en-IN")}`} />
          <Bar dataKey="rupees" fill="#0d9488" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
