import type { User } from "@supabase/supabase-js";
import type { Database } from "@softmaple/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import {
  ACTION_ERROR_CODE,
  actionFailure,
  actionSuccess,
  type ActionResult,
} from "@/lib/actions/result";

export type AuthenticatedContext = {
  readonly supabase: SupabaseClient<Database>;
  readonly user: User;
};

export const getAuthenticatedContext = async (): Promise<
  ActionResult<AuthenticatedContext>
> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error !== null || data.user === null) {
    return actionFailure(
      ACTION_ERROR_CODE.AuthenticationRequired,
      "Sign in to continue.",
    );
  }
  return actionSuccess({ supabase, user: data.user });
};
