export interface WeeklyUsage {
  status: "available" | "unavailable";
  remainingPercent: number | null;
  resetsAt: string | null;
  checkedAt: string;
}
