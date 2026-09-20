import { cn } from "@softmaple/ui/lib/utils";
import { AuthArtworkImage } from "./auth-artwork-image";

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

function NoteBrush() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 360 46"
      preserveAspectRatio="none"
      className="absolute -inset-x-[1%] inset-y-0 -z-10 h-full w-[102%] text-[#ffe38c] dark:text-[#e2bd4b]"
    >
      <defs>
        <filter
          id="auth-note-grain"
          x="-5%"
          y="-15%"
          width="110%"
          height="130%"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency=".035 .6"
            numOctaves="3"
            seed="12"
            result="grain"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="grain"
            scale="3.5"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <g filter="url(#auth-note-grain)" fill="currentColor">
        <path
          opacity=".6"
          d="M16 6C58 1 96 7 140 4L225 3 299 5 338 2Q354 3 357 17L355 28Q351 41 337 41L287 40 215 43 142 41 67 44 20 43Q4 41 3 29L5 16Q6 9 16 6Z"
        />
        <path
          opacity=".7"
          d="M21 10 79 8 130 10 196 7 267 9 329 7Q347 5 349 20L347 30Q344 37 328 37L249 37 177 38 110 37 49 40 19 38Q8 35 10 24L12 16Z"
        />
        <path
          fill="none"
          stroke="#fff1ae"
          strokeWidth="1.5"
          opacity=".22"
          d="M17 13 108 11 161 13 238 10 338 12M10 30 95 32 165 29 252 31 345 28M35 38 119 35 202 38 310 35"
        />
        <path
          fill="none"
          stroke="#946b1b"
          strokeWidth=".7"
          opacity=".14"
          d="M15 18 83 17M116 8 181 9M207 34 303 32M265 15 343 16M28 35 84 36"
        />
      </g>
    </svg>
  );
}

function CommentStem() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      className="absolute -left-[2.7cqw] -top-[1.7cqw] h-[4cqw] w-[4cqw] overflow-visible drop-shadow-[.2cqw_.35cqw_.25cqw_#0005]"
    >
      <defs>
        <linearGradient id="auth-comment-gold" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#fff0a0" />
          <stop offset=".45" stopColor="#f5cf43" />
          <stop offset="1" stopColor="#b78112" />
        </linearGradient>
      </defs>
      <path
        d="m2 2 28 22-5 6Z"
        fill="#8c610e"
        opacity=".6"
        transform="translate(.6 1)"
      />
      <path d="m2 2 28 22-5 6Z" fill="url(#auth-comment-gold)" />
      <path
        d="M2 2 25 24"
        fill="none"
        stroke="#fff2a6"
        strokeWidth=".9"
        strokeLinecap="round"
        opacity=".75"
      />
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
  const gradientId = `auth-cursor-${name.toLowerCase()}`;
  return (
    <div className={cn("absolute z-20", className)}>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 30"
        className="h-[4.8cqw] w-[3.8cqw] overflow-visible drop-shadow-[.4cqw_.65cqw_.4cqw_#0005]"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor={isAdam ? "#fff2a0" : "#cbd0d1"} />
            <stop offset=".4" stopColor={isAdam ? "#ffcc19" : "#a5aaac"} />
            <stop offset="1" stopColor={isAdam ? "#d69b0b" : "#717779"} />
          </linearGradient>
        </defs>
        <path
          fill={isAdam ? "#9c6b08" : "#44494b"}
          d="m2 1 20 17-11 1-5 10Z"
          transform="translate(.6 1)"
        />
        <path fill={`url(#${gradientId})`} d="m2 1 20 17-11 1-5 10Z" />
        <path
          fill={isAdam ? "#9a6500" : "#42484a"}
          opacity=".15"
          d="M2 1 11 19 6 29Z"
        />
        <path
          d="M6 28 2 1 21 17.5"
          fill="none"
          stroke={isAdam ? "#fff2aa" : "#ecf0ef"}
          strokeWidth=".7"
          strokeLinejoin="round"
          opacity=".65"
        />
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
        <AuthArtworkImage
          lightSrc={`/auth/paper-${mode}.webp`}
          darkSrc={`/auth/paper-${mode}-dark.webp`}
          unoptimized
          fill
          sizes="(min-width: 1536px) 860px, (min-width: 900px) 56vw, 1px"
          className={cn(
            "object-contain mix-blend-multiply dark:mix-blend-normal dark:drop-shadow-[0_18px_24px_#0003]",
            signup
              ? "scale-y-110 -translate-y-[17%]"
              : "scale-y-105 -translate-y-[8%]",
          )}
        />
        <div
          className={cn(
            "absolute z-10 -rotate-[15deg] [font-family:Courier_New,_Courier,_monospace] font-semibold text-[2.85cqw] leading-[1.9] tracking-[.025em] text-[#504c42] dark:text-[#e6e0d4]",
            signup ? "left-[21%] top-[22%]" : "left-[33%] top-[23%]",
          )}
        >
          <p>A little thought.</p>
          <p className="relative isolate -ml-[1.9cqw] px-[1.9cqw] dark:text-[#17130a]">
            <NoteBrush />A shared beginning.
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
            "absolute z-20 whitespace-nowrap rounded-[1.5cqw] border border-[#f4ddaa] bg-[#fff6df] px-[2.7cqw] py-[2.5cqw] text-[#92540a] shadow-[0_3px_6px_#aa7b161a] dark:border-[#a57719] dark:bg-[#3c3018] dark:text-[#ffedbb] dark:shadow-[0_3px_10px_#0003]",
            signup
              ? "left-[55%] top-[38.5%] text-[1.95cqw]"
              : "left-[67%] top-[43.5%] min-w-[26cqw] text-[2.25cqw]",
          )}
        >
          <CommentStem />
          Let&apos;s build on this.
        </div>
        <AuthArtworkImage
          lightSrc="/landing/veined-maple.webp"
          darkSrc="/auth/veined-maple-dark.webp"
          width={500}
          height={463}
          sizes="(min-width: 900px) 32vw, 1px"
          className={cn(
            "absolute z-10 h-auto opacity-35 dark:opacity-80",
            signup
              ? "left-[47%] top-[55%] w-[66%] -rotate-[20deg]"
              : "-left-[18%] top-[45%] w-[53%] -rotate-[11deg]",
          )}
        />
      </div>
    </section>
  );
}
