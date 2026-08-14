import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export async function GET() {
  if (!supabaseUrl || !supabasePublishableKey) {
    return NextResponse.json(
      { ok: false, error: "Missing Supabase configuration" },
      { status: 500 },
    );
  }

  try {
    const supabase = await createClient();

    const { error, status, statusText } = await supabase.rpc(
      "get_public_document_by_slug",
      { p_slug: "__softmaple_health_check__" },
    );

    if (error) {
      console.error("Supabase keep-alive error", error);
      return NextResponse.json(
        {
          ok: false,
          status: error.code ?? status ?? 500,
          error: error.message,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      status: status ?? 200,
      statusText: statusText ?? "OK",
    });
  } catch (error) {
    console.error("Failed to execute Supabase keep-alive query", error);
    return NextResponse.json(
      { ok: false, error: "Failed to reach Supabase" },
      { status: 500 },
    );
  }
}
