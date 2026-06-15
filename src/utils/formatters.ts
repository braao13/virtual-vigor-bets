export const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export const formatCurrency = (n: number | string | null | undefined) => formatMoney(n);

export function formatMoney(n: number | string | null | undefined) {
  if (n === null || n === undefined) return "—";
  const v = typeof n === "string" ? parseFloat(n) : n;
  return BRL.format(v);
}

export function formatOdds(n: number | string) {
  const v = typeof n === "string" ? parseFloat(n) : n;
  return v.toFixed(2);
}

export function formatMatchDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeDate(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  const minutes = Math.round(diff / 60000);
  if (minutes < 60 && minutes >= 0) return `em ${minutes} min`;
  if (minutes < 0) return "iniciado";
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `em ${hours}h`;
  return formatMatchDate(iso);
}
