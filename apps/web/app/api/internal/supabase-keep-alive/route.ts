import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function GET() {
  if (!supabaseUrl || !supabasePublishableKey) {
    return NextResponse.json(
      { ok: false, error: "Missing Supabase configuration" },
      { status: 500 },
    );
  }

  try {
    const supabase = await createClient();

    const { error, status, statusText } = await supabase
      .from("money_fort_hq_assessment_results")
      .select("id", { head: true, count: "estimated" })
      .limit(1);

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
