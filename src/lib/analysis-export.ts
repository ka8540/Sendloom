import type { AnalysisResponse } from "@/lib/analysis-types";

export function buildAnalysisCsv(data: AnalysisResponse) {
  const rows: Array<Array<string | number>> = [
    ["Sendloom Analysis", data.page],
    ["Local date range", `${data.range.from} to ${data.range.to}`],
    ["Timezone", data.range.timeZone],
    [],
    ["Metric", "Value", "Detail"]
  ];
  for (const item of data.metrics) {
    rows.push([item.label, item.format === "percent" ? `${item.value.toFixed(1)}%` : item.value, item.detail]);
  }
  rows.push([]);

  if (data.page === "overview" || data.page === "engagement") {
    rows.push(["Date", "Sent", "Opened", "Clicked", "Replied", "Open rate", "Click rate", "Reply rate"]);
    for (const point of data.trends) {
      rows.push([
        point.date,
        point.sent,
        point.opened,
        point.clicked,
        point.replied,
        `${point.openRate}%`,
        `${point.clickRate}%`,
        `${point.replyRate}%`
      ]);
    }
  } else if (data.page === "sequences") {
    rows.push(["Sequence", "Sent", "Replies", "Reply rate", "Status"]);
    for (const point of data.sequencePoints) rows.push([point.name, point.sent, point.replies, `${point.replyRate}%`, point.status]);
  } else if (data.page === "reliability") {
    rows.push(["Failure / outcome category", "Count", "Share"]);
    for (const item of data.failureReasons) rows.push([item.name, item.value, `${item.percent}%`]);
  } else if (data.page === "senders") {
    rows.push(["Sender", "Sent", "Opened", "Replied", "Reply rate", "24h used", "24h limit", "Health"]);
    for (const sender of data.senders) {
      rows.push([
        sender.email,
        sender.sent,
        sender.opened,
        sender.replied,
        `${sender.replyRate}%`,
        sender.capacity.used,
        sender.capacity.limit,
        sender.health
      ]);
    }
  }

  const escape = (value: string | number) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return rows.map((row) => row.map(escape).join(",")).join("\n");
}
