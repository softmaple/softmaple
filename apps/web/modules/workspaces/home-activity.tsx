import { HomeAction, HomeActionLink } from "./home-motion";
import Link from "next/link";
import { useId } from "react";
import { ArrowUpRight } from "lucide-react";
import { documentPresenceColor } from "@/modules/docs/document-presence-color";
import {
  homeFold,
  homeHand,
  homePaper,
  homePrimary,
  homeSerif,
} from "./home-styles";
import { HomeAvatar, HomeAvatars, writersAsPeople } from "./home-avatar";
import { UPDATE_EXAMPLES } from "./home-static-data";
import type { HomeProps } from "./home-types";
import {
  describeHappeningNow,
  describeLatestWords,
  describeWriterCount,
  hasOtherWriters,
  type ActiveWriter,
} from "./writing-activity";

/** Writer tags beyond this many collapse into a "+N" count. */
const VISIBLE_WRITER_TAGS = 3;

export function HomeActivity({
  activity,
  visualFixture,
  workspaceSlug,
  onBrowse,
}: Pick<HomeProps, "activity" | "visualFixture" | "workspaceSlug"> & {
  onBrowse: () => void;
}) {
  const titleId = useId();
  const featured = activity?.documents[0];
  const href = featured
    ? `/workspace/${workspaceSlug}/doc/${featured.slug}`
    : undefined;
  return (
    <section
      aria-label="Happening now"
      className="md:min-h-[244px] rounded-md border border-border px-[18px] pb-[17px] pt-[10px] shadow-[var(--ws-shadow)] max-md:px-[11px] max-md:py-2"
    >
      <h2 className="mb-[6px] hidden text-[10px] font-semibold tracking-[.17em] text-muted-foreground md:block">
        HAPPENING NOW
      </h2>
      <div className="flex min-w-0 gap-[15px] min-[1280px]:max-[1430px]:gap-3">
        <div
          className={`relative min-w-0 flex-1 md:h-[194px] md:max-lg:h-auto md:rounded-md md:border md:border-border md:p-[23px] md:pt-[14px] ${featured ? `${homePaper} ${homeFold} [--fold-size:42px]` : ""}`}
        >
          <p className="flex items-center gap-3 text-xs text-muted-foreground max-md:leading-none">
            <span
              className={`size-[11px] shrink-0 rounded-full ${featured ? "bg-[var(--ws-green)]" : "bg-muted-foreground/50"}`}
            />
            {featured ? (
              <>
                {describeWriterCount(featured.writers.length)}{" "}
                <span className="-ml-2 text-[var(--ws-green)]">writing</span>
              </>
            ) : activity === null ? (
              "Live activity is unavailable"
            ) : (
              "No one is writing right now"
            )}
          </p>
          <h3
            id={titleId}
            title={featured?.title}
            className={`${homeSerif} mt-2 line-clamp-2 break-words text-[35px] leading-[1.1] tracking-[-.045em] max-md:mt-1 max-md:text-[18px] md:line-clamp-1`}
          >
            {featured?.title ?? "A little room to keep writing"}
          </h3>
          <div className="relative mt-[8px] hidden max-w-[510px] md:block">
            {visualFixture && featured ? (
              <p
                className={`${homeSerif} max-[1430px]:line-clamp-3 text-[17px] leading-[1.38] text-muted-foreground`}
              >
                Ideas grow stronger when we share them. Softmaple is a place for
                curious <mark>minds to write together,</mark> think more
                clearly, and make progress — <FixtureCaret color="blue" />
                <br className="hidden min-[1450px]:block" /> side by side.{" "}
                <FixtureCaret color="purple" name="Mia" />
                Small steps, shared openly, can lead{" "}
                <FixtureCaret color="green" name="Leo" /> extraordinary things.
              </p>
            ) : featured && activity ? (
              <>
                <p
                  className={`${homeSerif} text-[17px] leading-[1.38] text-muted-foreground`}
                >
                  {describeLatestWords(featured, activity.observedAt)}
                </p>
                <ul
                  aria-label="People writing"
                  className="mt-[14px] flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2"
                >
                  {featured.writers
                    .slice(0, VISIBLE_WRITER_TAGS)
                    .map((writer) => (
                      <WriterTag key={writer.userId} writer={writer} />
                    ))}
                  {featured.writers.length > VISIBLE_WRITER_TAGS ? (
                    <li className="text-xs text-muted-foreground">
                      +{featured.writers.length - VISIBLE_WRITER_TAGS} more
                    </li>
                  ) : null}
                </ul>
              </>
            ) : (
              <p
                className={`${homeSerif} text-[17px] leading-[1.38] text-muted-foreground`}
              >
                Open a document and pick up a thought. Your next idea starts
                with a little space.
              </p>
            )}
          </div>
          {visualFixture && featured ? (
            <p
              aria-hidden="true"
              className={`${homeHand} absolute right-5 top-9 hidden -rotate-12 text-[25px] leading-[.85] text-muted-foreground min-[1450px]:block`}
            >
              This
              <br /> feels
              <br /> right.
              <span className="block text-right text-primary">＋</span>
            </p>
          ) : null}
          <div className="mt-1 flex items-center justify-between md:mt-4 min-[1024px]:hidden">
            {featured ? (
              <HomeAvatars people={writersAsPeople(featured.writers)} />
            ) : (
              <span className="text-xs text-muted-foreground">
                Pick up where you left off.
              </span>
            )}
            {href ? (
              <HomeActionLink
                aria-describedby={titleId}
                className={`${homePrimary} px-7 py-[6px] text-sm`}
                href={href}
              >
                Join
              </HomeActionLink>
            ) : (
              <HomeAction
                onClick={onBrowse}
                className={`${homePrimary} px-4 py-2 text-sm`}
              >
                Browse
              </HomeAction>
            )}
          </div>
        </div>
        <div className="hidden w-[252px] shrink-0 flex-col justify-center border-l border-border pl-6 pr-2 min-[1024px]:flex max-[1150px]:w-[210px] min-[1280px]:max-[1430px]:w-[200px] min-[1280px]:max-[1430px]:pl-4">
          {featured ? (
            <HomeAvatars people={writersAsPeople(featured.writers)} large />
          ) : null}
          <p
            className={`${homeSerif} mb-4 mt-4 text-[21px] leading-[1.25] tracking-[-.02em]`}
          >
            {featured
              ? describeHappeningNow(featured)
              : "Good ideas begin with a first line."}
          </p>
          {featured && href ? (
            <Link
              aria-describedby={titleId}
              className="flex h-[50px] items-center justify-center gap-3 rounded border border-foreground/70 font-medium"
              href={href}
            >
              {hasOtherWriters(featured) ? "Join document" : "Keep writing"}{" "}
              <ArrowUpRight className="size-5" />
            </Link>
          ) : (
            <button
              onClick={onBrowse}
              className="h-[50px] rounded border border-foreground/70 text-sm"
            >
              Open a document
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/** A writer's name on a caret in their editor cursor color. */
function WriterTag({ writer }: { writer: ActiveWriter }) {
  const color = documentPresenceColor(writer.userId);
  return (
    <li className="flex min-w-0 items-center gap-[3px] text-xs leading-none">
      <span
        aria-hidden="true"
        className="h-[18px] w-[2px] shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span
        className="max-w-[140px] truncate rounded-[3px] px-[7px] py-[4px] text-white"
        style={{ backgroundColor: color }}
      >
        {writer.isViewer ? "You" : writer.fullName}
      </span>
    </li>
  );
}

export function HomePeople({
  members,
  visualFixture,
  workspaceSlug,
}: Pick<HomeProps, "members" | "visualFixture" | "workspaceSlug">) {
  return (
    <section className="border-b border-border pb-8" aria-label="Your people">
      <h2 className={`${homeSerif} mb-4 text-[23px] tracking-[-.04em]`}>
        <Link
          prefetch={false}
          href={`/workspace/${workspaceSlug}/settings?tab=members`}
        >
          Your people
        </Link>
      </h2>
      <ul className="space-y-[22px]">
        {members.slice(0, 3).map((member, index) => (
          <li
            className="flex min-w-0 items-center gap-3"
            key={member.member_id}
          >
            <span className="relative">
              <HomeAvatar
                person={member}
                className="size-[46px]"
                index={index}
              />
              {visualFixture ? (
                <span
                  className={`absolute bottom-0 right-0 size-[13px] rounded-full border-2 border-background ${index === 2 ? "bg-[var(--ws-blue)]" : "bg-[var(--ws-green)]"}`}
                />
              ) : null}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {member.full_name}
              </span>
              <span className="mt-1 block truncate text-[13px] text-muted-foreground">
                {visualFixture
                  ? index === 2
                    ? "Online"
                    : "Writing in A brighter tomorrow"
                  : member.role.toLowerCase()}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Your workspace members will appear here.
        </p>
      ) : null}
    </section>
  );
}

export function HomeUpdates() {
  return (
    <section aria-label="Updates — static design preview" className="pt-7">
      <h2
        className={`${homeSerif} mb-4 text-[23px] tracking-[-.04em]`}
        title="Static design preview. Notifications are not connected."
      >
        Updates<span className="sr-only"> — static design preview</span>
      </h2>
      <div className="space-y-4">
        {UPDATE_EXAMPLES.map((update, index) => (
          <article
            key={update.name}
            className="flex gap-[10px] border-b border-border pb-[18px] last:border-0"
          >
            <HomeAvatar
              person={{ full_name: update.name, avatar_src: update.avatar_src }}
              className="size-[46px]"
              index={index}
            />
            <div className="min-w-0 flex-1">
              <p className="pt-1 text-[14px] leading-[1.6] text-muted-foreground">
                <time className="float-right ml-1 text-xs">{update.time}</time>
                <span className="text-foreground">{update.name}</span>{" "}
                {update.action}
                <br />
                <span className="text-foreground">A brighter tomorrow</span>
              </p>
              <blockquote
                className={`${homeSerif} mt-[6px] rounded bg-muted/70 px-3 py-[11px] italic leading-[1.25] tracking-normal text-muted-foreground ${index === 1 ? "text-[16px]" : "text-[17px]"}`}
              >
                “{index === 1 ? <mark>{update.quote}</mark> : update.quote}”
              </blockquote>
            </div>
          </article>
        ))}
      </div>
      <p
        aria-hidden="true"
        className={`${homeHand} ml-auto mr-2 mt-[55px] w-[110px] -rotate-[17deg] text-[25px] leading-[1.05] text-muted-foreground`}
      >
        Same
        <br /> thoughts.
        <br />
        Brighter
        <br /> tomorrows.
        <span className="mt-2 block h-3 w-[88px] rounded-[50%] border-t border-current" />
      </p>
    </section>
  );
}

/** Decorative collaboration indicators belong only to the visual fixture. */
function FixtureCaret({
  color,
  name,
}: {
  color: "blue" | "purple" | "green";
  name?: string;
}) {
  const colors = {
    blue: "[--caret:#527eff]",
    purple: "[--caret:#b653ec]",
    green: "[--caret:#32bf9d]",
  } as const;
  return (
    <span
      aria-hidden="true"
      className={`${colors[color]} relative mx-[2px] inline-block h-[17px] w-[2px] bg-[var(--caret)] align-text-bottom before:absolute before:-left-px before:-top-[2px] before:size-1 before:rounded-full before:bg-[var(--caret)] before:content-['']`}
    >
      {name ? (
        <span className="absolute left-[2px] top-5 rounded-[3px] bg-[var(--caret)] px-[7px] py-[3px] text-white [font:12px_var(--font-body),sans-serif] max-[1430px]:hidden">
          {name}
        </span>
      ) : null}
    </span>
  );
}
