import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { formatMatchDate } from "@/utils/formatters";

export const Route = createFileRoute("/notifications")({
  head: () => ({ meta: [{ title: "Notificações — Rabbet" }] }),
  component: () => (
    <AppShell>
      <NotificationsPage />
    </AppShell>
  ),
});

interface Notification {
  id: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

function NotificationsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: notifications } = useQuery({
    queryKey: ["notifications", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, message, is_read, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Notification[];
    },
  });

  const markAllMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("is_read", false);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markOneMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unreadCount = notifications?.filter((n) => !n.is_read).length ?? 0;

  return (
    <div className="px-4 md:px-8 py-6 max-w-2xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Notificações</h1>
          {unreadCount > 0 && (
            <p className="text-sm text-muted-foreground mt-1">{unreadCount} não lida{unreadCount > 1 ? "s" : ""}</p>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={() => markAllMut.mutate()}
            disabled={markAllMut.isPending}
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-surface disabled:opacity-50"
          >
            <CheckCheck className="h-4 w-4" />
            Marcar todas como lidas
          </button>
        )}
      </header>

      <div className="space-y-2">
        {(notifications ?? []).map((n) => (
          <button
            key={n.id}
            onClick={() => !n.is_read && markOneMut.mutate(n.id)}
            className={`w-full text-left rounded-xl border px-4 py-3.5 transition-colors ${
              n.is_read
                ? "border-border bg-card opacity-60"
                : "border-primary/30 bg-card hover:bg-surface cursor-pointer"
            }`}
          >
            <div className="flex items-start gap-3">
              {!n.is_read && <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />}
              <div className={!n.is_read ? "" : "pl-5"}>
                <p className="text-sm font-semibold">{n.title}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{n.message}</p>
                <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                  {formatMatchDate(n.created_at)}
                </p>
              </div>
            </div>
          </button>
        ))}

        {notifications && notifications.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground flex flex-col items-center gap-3">
            <Bell className="h-8 w-8 opacity-30" />
            <p>Nenhuma notificação ainda.</p>
          </div>
        )}
      </div>
    </div>
  );
}
