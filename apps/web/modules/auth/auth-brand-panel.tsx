import Image from "next/image";
import { cn } from "@softmaple/ui/lib/utils";

type AuthBrandPanelProps = { readonly mode: "login" | "signup" };

function Brush() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 220 88"
      preserveAspectRatio="none"
      className="absolute -inset-x-[14%] -bottom-[8%] -z-10 h-[112%] w-[128%] -rotate-3 text-[#ffd45d] dark:text-[#f6cb4f]"
    >
      <defs>
        <filter
          id="auth-brush-grain"
          x="-10%"
          y="-20%"
          width="120%"
          height="140%"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.07 0.3"
            numOctaves="3"
            seed="7"
            result="grain"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="grain"
            scale="7"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <g filter="url(#auth-brush-grain)">
        <path
          fill="currentColor"
          opacity=".28"
          className="dark:opacity-75"
          d="m9 27 18-9C59 5 128 1 182 9l20 5-4 8 7 5-5 9 5 5-6 8 8 9-8 5 6 10-32-2C125 72 79 77 26 86l8-11-26 1 10-12L2 64l15-12-9-4 11-10Z"
        />
        <path
          fill="currentColor"
          opacity=".48"
          className="dark:opacity-100"
          d="m16 35 23-13C83 11 139 9 198 18l-6 9 15 2-12 9 9 8-13 5 15 7-25 5C121 62 83 67 20 79l13-12-17 1 15-12-18-1 12-10Z"
        />
        <path
          fill="#ffe9a0"
          opacity=".55"
          d="M28 36C88 16 146 24 208 24l-16 5C128 27 78 28 23 45Zm-8 28c76-21 129-21 180-18l-11 5C122 47 68 62 15 71Z"
        />
      </g>
    </svg>
  );
}

function Collaborator({
  name,
  className,
}: {
  readonly name: "Adam" | "Mia";
  readonly className: string;
}) {
  const isAdam = name === "Adam";
  return (
    <div className={cn("absolute z-20", className)}>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 30"
        className={cn(
          "h-[4.8cqw] w-[3.8cqw] drop-shadow-[0_2px_2px_#0002]",
          isAdam ? "text-[#ffcc19]" : "text-[#848889]",
        )}
      >
        <path fill="currentColor" d="m2 1 20 17-11 1-5 10Z" />
      </svg>
      <span
        className={cn(
          "ml-[3cqw] block w-max rounded-[4px] px-[1.6cqw] py-[.65cqw] text-[2.25cqw] leading-tight",
          isAdam
            ? "bg-[#ffdf75] text-[#624c14] dark:bg-[#f6ca3e] dark:text-[#241c08]"
            : "bg-[#dfe1e3] text-[#3f4449] dark:bg-[#53524e] dark:text-[#f4f0e8]",
        )}
      >
        {name}
      </span>
    </div>
  );
}

/** A single coordinate system keeps the paper and its annotations registered. */
export function AuthBrandPanel({ mode }: AuthBrandPanelProps) {
  const signup = mode === "signup";
  return (
    <section
      aria-label="Ideas grow together"
      className="pointer-events-none relative hidden min-w-0 self-stretch @container min-[56.25rem]:block"
    >
      <h2
        className={cn(
          "absolute top-[4cqw] z-20 m-0 font-normal text-[11.3cqw] leading-[.96] tracking-[-.045em] [font-family:Georgia,_'Times_New_Roman',_serif]",
          signup ? "left-[15.6%]" : "left-[18.8%]",
        )}
      >
        {signup ? (
          <>
            Good ideas start
            <br />
            with{" "}
          </>
        ) : (
          <>
            Good to have
            <br />
            you{" "}
          </>
        )}
        <span className="relative isolate whitespace-nowrap dark:text-[#100f0b]">
          <Brush />
          {signup ? "you." : "back."}
        </span>
      </h2>
      <div
        aria-hidden="true"
        data-auth-artwork={mode}
        className="absolute left-0 top-[28cqw] aspect-square w-full [clip-path:inset(-50%_0_-50%_0)]"
      >
        <Image
          src={`/auth/paper-${mode}.webp`}
          unoptimized
          alt=""
          fill
          loading="eager"
          sizes="(min-width: 1536px) 860px, (min-width: 900px) 56vw, 1px"
          className={cn(
            "object-contain mix-blend-multiply dark:hidden",
            signup
              ? "scale-y-110 -translate-y-[17%]"
              : "scale-y-105 -translate-y-[8%]",
          )}
        />
        <Image
          src={`/auth/paper-${mode}-dark.webp`}
          unoptimized
          alt=""
          fill
          loading="eager"
          sizes="(min-width: 1536px) 860px, (min-width: 900px) 56vw, 1px"
          className={cn(
            "hidden object-contain drop-shadow-[0_18px_24px_#0003] dark:block",
            signup
              ? "scale-y-110 -translate-y-[17%]"
              : "scale-y-105 -translate-y-[8%]",
          )}
        />
        <div
          className={cn(
            "absolute z-10 -rotate-[15deg] [font-family:Courier_New,_Courier,_monospace] text-[2.85cqw] leading-[1.9] tracking-[.025em] text-[#504c42] dark:text-[#e6e0d4]",
            signup ? "left-[21%] top-[22%]" : "left-[33%] top-[23%]",
          )}
        >
          <p>A little thought.</p>
          <p className="-ml-[1.9cqw] rounded-[1.7cqw] bg-[#ffe38c]/60 px-[1.9cqw] dark:bg-[#ebc14c]/90 dark:text-[#17130a]">
            A shared beginning.
          </p>
        </div>
        <Collaborator
          name="Adam"
          className={
            signup ? "left-[32.5%] top-[33.5%]" : "left-[41%] top-[37.5%]"
          }
        />
        <Collaborator
          name="Mia"
          className={
            signup ? "left-[55%] top-[27.5%]" : "left-[69%] top-[30.5%]"
          }
        />
        <div
          className={cn(
            "absolute z-20 whitespace-nowrap rounded-[1.5cqw] border border-[#f4ddaa] bg-[#fff6df] px-[2.7cqw] py-[2.5cqw] text-[#92540a] shadow-[0_3px_6px_#aa7b161a] before:absolute before:-left-[2.5cqw] before:top-[.8cqw] before:h-px before:w-[3.5cqw] before:rotate-45 before:bg-[#efce68] dark:border-[#a57719] dark:bg-[#3c3018] dark:text-[#ffedbb] dark:shadow-[0_3px_10px_#0003] dark:before:bg-[#d8a92c]",
            signup
              ? "left-[55%] top-[38.5%] text-[1.95cqw]"
              : "left-[67%] top-[43.5%] min-w-[26cqw] text-[2.25cqw]",
          )}
        >
          Let&apos;s build on this.
        </div>
        <Image
          src="/landing/veined-maple.webp"
          loading="eager"
          alt=""
          width={500}
          height={463}
          sizes="(min-width: 900px) 32vw, 1px"
          className={cn(
            "absolute z-10 h-auto opacity-35 dark:hidden",
            signup
              ? "left-[47%] top-[55%] w-[66%] -rotate-[20deg]"
              : "-left-[18%] top-[45%] w-[53%] -rotate-[11deg]",
          )}
        />
        <Image
          src="/auth/veined-maple-dark.webp"
          loading="eager"
          alt=""
          width={500}
          height={463}
          sizes="(min-width: 900px) 32vw, 1px"
          className={cn(
            "absolute z-10 hidden h-auto opacity-80 dark:block",
            signup
              ? "left-[47%] top-[55%] w-[66%] -rotate-[20deg]"
              : "-left-[18%] top-[45%] w-[53%] -rotate-[11deg]",
          )}
        />
      </div>
    </section>
  );
}
