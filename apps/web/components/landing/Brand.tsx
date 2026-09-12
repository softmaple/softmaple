import { cn } from "@softmaple/ui/lib/utils";

export function MapleMark() {
  return (
    <svg viewBox="0 0 32 36" fill="currentColor" aria-hidden="true">
      <path d="m16 0 3.1 7.4 3.4-2-1 9 4.9-4.1.7 4.1 4.9-.7-2.6 5 2.1 1.9-9.7 7.1.8 4.1-5.7-1.2.4 5.4h-2.6l.4-5.4-5.7 1.2.8-4.1L.5 20.6l2.1-1.9-2.6-5 4.9.7.7-4.1 4.9 4.1-1-9 3.4 2L16 0Z" />
    </svg>
  );
}

export function LandingBrand() {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[15px] text-[clamp(24px,_2.2vw,_32px)] tracking-[-1.4px] font-medium",
        "whitespace-nowrap [&_svg]:w-9 [&_svg]:h-[42px]",
        "min-[768px]:max-[1024px]:gap-2.5 min-[768px]:max-[1024px]:text-[25px] min-[768px]:max-[1024px]:[&_svg]:w-7",
        "min-[768px]:max-[1024px]:[&_svg]:h-[34px]",
        "max-[768px]:text-[24px] max-[768px]:gap-2.5 max-[768px]:tracking-[-1px] max-[768px]:[&_svg]:w-[26px]",
        "max-[768px]:[&_svg]:h-8",
        "leading-[1]",
      )}
    >
      <MapleMark />
      <span>softmaple</span>
    </span>
  );
}
