import { createClient } from "@/utils/supabase/server";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@softmaple/ui/components/card";
import Link from "next/link";

export async function AuthGuard({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.getUser();

  const isAuthenticated = !error && data?.user;

  if (isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Already logged in</CardTitle>
            <CardDescription>
              You are already signed in. Please go to your{" "}
              <Link href="/dashboard" className="text-primary hover:underline">
                dashboard
              </Link>
              .
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return children;
}
