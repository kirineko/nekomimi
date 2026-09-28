export function sessionTime(value: string | null | undefined, now: number) {
  const time = Date.parse(value ?? "");
  if (!Number.isFinite(time)) return { group: "时间未知", relative: "时间未知", full: "时间未知", iso: undefined };
  const date = new Date(time), today = new Date(now);
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
  const days = day(today) - day(date);
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  return {
    group: days <= 0 ? "今天" : days === 1 ? "昨天" : days < 7 ? "近 7 天" : "更早",
    relative: minutes < 1 ? "刚刚" : minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前` : `${Math.floor(minutes / 1440)} 天前`,
    full: date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" }),
    iso: date.toISOString(),
  };
}
