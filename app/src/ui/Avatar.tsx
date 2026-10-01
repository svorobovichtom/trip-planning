// Generative avatar (boring-avatars «beam», MIT). Seeded with the person's id,
// so it stays the same after a rename and on every phone. Decorative: the
// name is always shown next to it.
import BoringAvatar from "boring-avatars";
import { memo } from "react";
import type { Person } from "../lib/types";
import "./avatar.css";

export const AVATAR_COLORS = ["#2B2A28", "#C9541F", "#E8B07A", "#7C8B6F", "#EFE6D8"];

function AvatarImpl({ person, size = 24, className }: {
  /** unknown / not chosen -> a neutral circle */
  person?: Pick<Person, "id"> | null;
  size?: number;
  className?: string;
}) {
  const cls = `av${className ? ` ${className}` : ""}`;
  if (!person?.id) return <span className={`${cls} av-none`} style={{ width: size, height: size }} aria-hidden="true" />;
  return (
    <BoringAvatar
      className={cls}
      variant="beam"
      name={person.id}
      colors={AVATAR_COLORS}
      size={size}
      role={undefined}
      aria-hidden="true"
      focusable="false"
    />
  );
}

/** Re-renders only when the id, size or class change (callers may pass `{ id }` inline). */
export const Avatar = memo(AvatarImpl, (a, b) => a.person?.id === b.person?.id && a.size === b.size && a.className === b.className);
