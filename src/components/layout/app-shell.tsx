import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useAuth, type Profile } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { AppSidebar, MobileBottomNav } from "@/components/layout/app-sidebar";
import { BetSlip } from "@/components/betting/bet-slip";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/auth" });
    }
  }, [loading, user, navigate]);

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
  });

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <AppSidebar profile={profile ?? null} />
      <main className="flex-1 min-w-0 pb-20 md:pb-0">{children}</main>
      <BetSlip />
      <BetSlip floating />
      <MobileBottomNav />
    </div>
  );
}
