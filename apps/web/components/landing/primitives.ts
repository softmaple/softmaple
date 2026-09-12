export const primaryClasses = [
  "min-h-16 inline-flex items-center justify-center gap-[22px] py-0 px-7 rounded-[6px] text-[20px] leading-[1.2]",
  "tracking-[-0.65px] [transition:background_160ms,_box-shadow_160ms] bg-(--yellow) border border-(--yellow)",
  "text-[#10100c] font-semibold hover:bg-[#f2ce06] hover:border-[#f2ce06] hover:shadow-[0_4px_14px_#b7930017]",
  "[&_svg]:w-[26px] [&_svg]:h-[26px]",
  "max-[1200px]:text-[16px] max-[1200px]:min-h-[54px] max-[1200px]:py-0 max-[1200px]:px-[23px] max-[1200px]:gap-4",
  "max-[768px]:min-h-[50px] max-[768px]:py-0 max-[768px]:px-[22px] max-[768px]:text-[16px]",
].join(" ");

export const iconButtonClasses = [
  "inline-grid place-items-center w-11 h-11 shrink-0 rounded-[5px] bg-transparent text-inherit",
  "hover:bg-[color-mix(in_srgb,_var(--ink)_7%,_transparent)] [&_svg]:w-5 [&_svg]:h-5 [&_svg]:[grid-area:1_/_1]",
].join(" ");

export const cursorClasses = [
  "[--cursor-color:#9660c8] absolute text-white bg-(--cursor-color) [font-family:var(--font-body),_sans-serif]",
  "font-semibold not-italic text-[12px] tracking-[-0.2px] leading-[1] py-2 px-2.5 rounded-[4px] whitespace-nowrap",
  "shadow-[0_2px_6px_#0000000d] before:content-[''] before:absolute before:-top-3 before:bottom-0 before:-left-1.5",
  "before:w-0.5 before:bg-(--cursor-color)",
].join(" ");

export const handwrittenClasses = [
  "[font-family:'Bradley_Hand',_'Softmaple_Hand',_'Segoe_Print',_cursive] font-normal italic leading-[1.15]",
  "tracking-[-0.03em] [&_i]:block [&_i]:mt-[15px] [&_i]:w-[70%] [&_i]:h-[18px] [&_i]:border-t",
  "[&_i]:border-t-current [&_i]:[transform:rotate(-12deg)]",
].join(" ");
