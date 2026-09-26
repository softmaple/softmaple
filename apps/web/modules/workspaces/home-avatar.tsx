import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@softmaple/ui/components/avatar";
import type { HomePerson } from "./home-types";

export function HomeAvatar({
  person,
  className = "size-9",
  index = 0,
}: {
  person: HomePerson;
  className?: string;
  index?: number;
}) {
  return (
    <Avatar className={`shrink-0 border-2 border-background ${className}`}>
      <AvatarImage src={person.avatar_src ?? undefined} alt="" />
      <AvatarFallback
        className={`text-xs text-foreground ${index % 3 === 0 ? "bg-[var(--ws-avatar-purple)]" : index % 3 === 1 ? "bg-[var(--ws-avatar-green)]" : "bg-[var(--ws-avatar-sand)]"}`}
      >
        {person.full_name
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0])
          .join("")}
      </AvatarFallback>
    </Avatar>
  );
}
export function HomeAvatars({
  people,
  large = false,
}: {
  people: ReadonlyArray<HomePerson>;
  large?: boolean;
}) {
  return (
    <div
      className="flex shrink-0 -space-x-1"
      role="group"
      aria-label={people.map((person) => person.full_name).join(", ")}
    >
      {people.slice(0, 3).map((person, index) => (
        <HomeAvatar
          key={`${person.full_name}-${index}`}
          person={person}
          index={index}
          className={large ? "size-10" : "size-[30px]"}
        />
      ))}
      {people.length > 3 ? (
        <span className="grid size-[30px] place-items-center rounded-full bg-muted text-xs text-muted-foreground">
          +{people.length - 3}
        </span>
      ) : null}
    </div>
  );
}
