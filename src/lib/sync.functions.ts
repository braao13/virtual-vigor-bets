import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getServerClient } from "@/integrations/supabase/client.server";

const actionSchema = z.object({
  action: z.enum(["odds", "results", "all"]).default("all"),
});

export const syncMatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => actionSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = getServerClient();

    const { data: fnData, error } = await supabase.functions.invoke("sync-matches", {
      body: {},
      headers: {},
    });

    // Pass action as query param via URL workaround — invoke doesn't support query params
    // so we call the function URL directly using the service key
    const supabaseUrl = process.env["SUPABASE_URL"] ?? "";
    const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

    const res = await fetch(
      `${supabaseUrl}/functions/v1/sync-matches?action=${data.action}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Sync falhou: ${text}`);
    }

    return await res.json();
  });
