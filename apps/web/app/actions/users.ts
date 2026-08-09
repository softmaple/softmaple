"use server";

import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { UsersType } from "@/types/model";
import { getAuthenticatedContext } from "@/lib/actions/authenticated";
import {
  ACTION_ERROR_CODE,
  actionFailure,
  actionSuccess,
  fromDatabaseError,
  fromZodError,
  type ActionResult,
} from "@/lib/actions/result";

const AVATAR_BUCKET = "avatars";
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_AVATAR_DIMENSION = 2048;
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXTENSION_BY_TYPE: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

type UserRow = UsersType["Row"];

const displayNameSchema = z.object({
  displayName: z.string().trim().min(1, "Display name is required.").max(80),
});

const avatarObjectPath = (publicUrl: string | null): string | null => {
  if (publicUrl === null) return null;
  const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
  try {
    const url = new URL(publicUrl);
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    return decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
  } catch {
    return null;
  }
};

export const getCurrentProfile = async (): Promise<ActionResult<UserRow>> => {
  const context = await getAuthenticatedContext();
  if (!context.ok) return context;
  const { data, error } = await context.data.supabase
    .from("users")
    .select("*")
    .eq("id", context.data.user.id)
    .single();
  if (error !== null) {
    return fromDatabaseError(error, "Could not load your profile.");
  }
  return actionSuccess(data);
};

export const updateProfile = async (
  input: unknown,
): Promise<ActionResult<UserRow>> => {
  const parsed = displayNameSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const context = await getAuthenticatedContext();
  if (!context.ok) return context;
  const { data, error } = await context.data.supabase
    .from("users")
    .update({
      first_name: parsed.data.displayName,
      full_name: parsed.data.displayName,
      last_name: null,
    })
    .eq("id", context.data.user.id)
    .select("*")
    .single();
  if (error !== null) {
    return fromDatabaseError(error, "Could not update your profile.");
  }
  revalidatePath("/settings/account");
  return actionSuccess(data);
};

export const uploadAvatar = async (
  formData: FormData,
): Promise<ActionResult<UserRow>> => {
  const file = formData.get("avatar");
  if (!(file instanceof File)) {
    return actionFailure(
      ACTION_ERROR_CODE.Validation,
      "Choose an image to upload.",
      { avatar: ["Choose a JPEG, PNG, or WebP image."] },
    );
  }
  if (!ALLOWED_AVATAR_TYPES.has(file.type) || file.size > MAX_AVATAR_BYTES) {
    return actionFailure(
      ACTION_ERROR_CODE.Validation,
      "Use a JPEG, PNG, or WebP image no larger than 2 MB.",
      { avatar: ["The selected image type or size is not supported."] },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: MAX_AVATAR_DIMENSION * MAX_AVATAR_DIMENSION,
    }).metadata();
  } catch {
    return actionFailure(
      ACTION_ERROR_CODE.Validation,
      "The selected file is not a valid supported image.",
      { avatar: ["Choose a valid JPEG, PNG, or WebP image."] },
    );
  }
  if (
    metadata.width === undefined ||
    metadata.height === undefined ||
    metadata.width > MAX_AVATAR_DIMENSION ||
    metadata.height > MAX_AVATAR_DIMENSION
  ) {
    return actionFailure(
      ACTION_ERROR_CODE.Validation,
      "Avatar dimensions must be 2048 × 2048 pixels or smaller.",
      { avatar: ["Resize this image and try again."] },
    );
  }

  const context = await getAuthenticatedContext();
  if (!context.ok) return context;
  const currentProfile = await getCurrentProfile();
  if (!currentProfile.ok) return currentProfile;

  const extension = EXTENSION_BY_TYPE[file.type];
  if (extension === undefined) {
    return actionFailure(
      ACTION_ERROR_CODE.Validation,
      "The selected image type is not supported.",
    );
  }
  const objectPath = `${context.data.user.id}/${Date.now()}-${randomBytes(6).toString("hex")}.${extension}`;
  const { error: uploadError } = await context.data.supabase.storage
    .from(AVATAR_BUCKET)
    .upload(objectPath, bytes, {
      cacheControl: "31536000",
      contentType: file.type,
      upsert: false,
    });
  if (uploadError !== null) {
    return actionFailure(
      ACTION_ERROR_CODE.Storage,
      "Could not upload the avatar. Try again.",
    );
  }

  const { data: publicUrlData } = context.data.supabase.storage
    .from(AVATAR_BUCKET)
    .getPublicUrl(objectPath);
  const { data, error: profileError } = await context.data.supabase
    .from("users")
    .update({
      avatar_alt: `${currentProfile.data.full_name || "User"} avatar`,
      avatar_src: publicUrlData.publicUrl,
    })
    .eq("id", context.data.user.id)
    .select("*")
    .single();
  if (profileError !== null) {
    await context.data.supabase.storage
      .from(AVATAR_BUCKET)
      .remove([objectPath]);
    return fromDatabaseError(profileError, "Could not update your avatar.");
  }

  const previousPath = avatarObjectPath(currentProfile.data.avatar_src);
  if (previousPath !== null && previousPath !== objectPath) {
    await context.data.supabase.storage
      .from(AVATAR_BUCKET)
      .remove([previousPath]);
  }
  revalidatePath("/settings/account");
  return actionSuccess(data);
};

export const removeAvatar = async (): Promise<ActionResult<UserRow>> => {
  const context = await getAuthenticatedContext();
  if (!context.ok) return context;
  const currentProfile = await getCurrentProfile();
  if (!currentProfile.ok) return currentProfile;

  const { data, error } = await context.data.supabase
    .from("users")
    .update({ avatar_alt: null, avatar_src: null })
    .eq("id", context.data.user.id)
    .select("*")
    .single();
  if (error !== null) {
    return fromDatabaseError(error, "Could not remove your avatar.");
  }

  const previousPath = avatarObjectPath(currentProfile.data.avatar_src);
  if (previousPath !== null) {
    await context.data.supabase.storage
      .from(AVATAR_BUCKET)
      .remove([previousPath]);
  }
  revalidatePath("/settings/account");
  return actionSuccess(data);
};
