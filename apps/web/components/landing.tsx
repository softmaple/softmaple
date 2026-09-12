import { cn } from "@softmaple/ui/lib/utils";
import {
  cursorClasses,
  handwrittenClasses,
  primaryClasses,
} from "./landing/primitives";
import "./landing/animations.css";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight } from "lucide-react";
import { SITE_CONFIG } from "@softmaple/config";
import { LandingBrand } from "./landing/Brand";
import {
  LandingHeader,
  Narrative,
  CollaborationDemo,
  HeroMotion,
} from "./landing/Interactions";

function StartWriting({ hero = false }: { hero?: boolean }) {
  return (
    <Link
      className={cn(
        primaryClasses,
        hero &&
          "min-[768px]:max-[1024px]:py-0 min-[768px]:max-[1024px]:px-[17px] min-[768px]:max-[1024px]:min-h-[46px] min-[768px]:max-[1024px]:text-[14px]",
      )}
      href="/signup"
    >
      Start writing <ArrowRight aria-hidden="true" />
    </Link>
  );
}

export default function LandingPage() {
  return (
    <div
      className={cn(
        "[--paper:#faf9f6] [--ink:#0c0c0b] [--muted-ink:#596273] [--line:#d6d6d4] [--surface:#fffefc] [--yellow:#ffe128]",
        "bg-(--paper) text-(--ink) [font-family:var(--font-body),_Arial,_sans-serif] overflow-clip",
        "[&_:where(a,_button,_textarea,_input):focus-visible]:[outline:3px_solid_#967200]",
        "[&_:where(a,_button,_textarea,_input):focus-visible]:[outline-offset:5px] [&_button]:cursor-pointer",
        "[&_a]:[-webkit-tap-highlight-color:transparent] [&_button]:[-webkit-tap-highlight-color:transparent]",
        "[&_a]:no-underline [&_:where(button,_a)]:touch-manipulation [&_:where(a,_button):active]:[translate:0_1px]",
        "dark:[--paper:#191a18] dark:[--ink:#f6f5f0] dark:[--muted-ink:#b8bebf] dark:[--line:#454742]",
        "dark:[--surface:#222420]",
        "motion-reduce:[&_*]:animate-none! motion-reduce:[&_*]:transition-none!",
        "motion-reduce:[&_*]:[scroll-behavior:auto]! motion-reduce:[&_*::before]:animate-none!",
        "motion-reduce:[&_*::before]:transition-none! motion-reduce:[&_*::before]:[scroll-behavior:auto]!",
        "motion-reduce:[&_*::after]:animate-none! motion-reduce:[&_*::after]:transition-none!",
        "motion-reduce:[&_*::after]:[scroll-behavior:auto]!",
      )}
    >
      <a
        className={cn(
          "absolute w-[1px] h-[1px] overflow-hidden [clip-path:inset(50%)] whitespace-nowrap focus:z-50 focus:top-3",
          "focus:left-5 focus:w-auto focus:h-auto focus:[clip-path:none] focus:p-4 focus:bg-(--yellow) focus:text-[#111]",
        )}
        href="#main"
      >
        Skip to content
      </a>
      <main id="main">
        <section
          className={cn(
            "relative isolate h-[min(74.5vw,_1120px)] min-h-[740px]",
            "max-[1200px]:min-h-0",
            "min-[768px]:max-[1024px]:h-[760px]",
            "max-[768px]:h-auto max-[768px]:min-h-[890px] max-[768px]:pb-[450px]",
            "max-[361px]:min-h-[860px] max-[361px]:pb-[400px]",
          )}
          id="product"
          aria-labelledby="hero-title"
        >
          <LandingHeader />
          <HeroMotion>
            <Image
              className={cn(
                "absolute w-full h-full object-cover object-center [transform:translateY(calc(var(--unfold)_*_-32px))]",
                "opacity-[calc(1_-_var(--unfold)_*_0.25)]",
                "dark:[filter:brightness(0.53)_saturate(0.65)]",
                "dark:[mask-image:linear-gradient(to_right,_transparent,_#000_65%)]",
                "max-[768px]:object-contain max-[768px]:dark:[mask-image:linear-gradient(to_bottom,_transparent,_#000_22%)]",
                "motion-reduce:transform-none",
              )}
              src="/landing/paper-ribbon.webp"
              alt=""
              width={1448}
              height={1086}
              sizes="100vw"
              preload
            />
            <div
              className={cn(
                "absolute top-[52%] left-[43%] w-[36.5%] text-[#424341] [font-family:Georgia,_'Times_New_Roman',_serif]",
                "text-[1.4cqw] [transform:translateY(calc(var(--unfold)_*_-24px))_rotate(calc(12deg_-_var(--unfold)_*_10deg))]",
                "origin-center before:content-[''] before:absolute before:[inset:-25px_-32px] before:-z-1 before:bg-[#fffefc]",
                "before:border before:border-[#d6d6d4] before:shadow-[0_14px_40px_#1a191014]",
                "before:opacity-[calc(var(--unfold)_*_0.9)] [&_h2]:text-[3.5cqw] [&_h2]:font-medium [&_h2]:italic",
                "[&_h2]:tracking-[-0.08em] [&_h2]:mt-0 [&_h2]:mx-0 [&_h2]:mb-[1.5cqw] [&_h2]:whitespace-nowrap",
                "[&_p_+_p]:mt-[1cqw] [&_mark]:bg-[#f6df686b] [&_mark]:text-inherit",
                "dark:text-[#fffbed] dark:[text-shadow:0_1px_2px_#0003] dark:before:bg-[#282923] dark:before:border-[#626357]",
                "max-[768px]:top-[53%] max-[768px]:left-[40%] max-[768px]:w-[39%] max-[768px]:text-[1.85cqw]",
                "max-[768px]:[&_h2]:text-[3.7cqw]",
                "leading-[1.65] [&_h2]:leading-[1]",
              )}
            >
              <p className="[font-family:var(--font-body),_sans-serif] text-[0.7cqw] tracking-[0.22em] font-semibold mb-[1.1cqw] max-[768px]:text-[1cqw]">
                01 / NOTES
              </p>
              <h2>A brighter tomorrow</h2>
              <p>
                Ideas grow stronger when we share them. Softmaple is a{" "}
                <mark>place for curious minds</mark> to write together, think
                more clearly, and make progress — side by side.
              </p>
              <p>
                Small steps, shared openly, can lead to extraordinary things.
                Let’s build a kinder, more thoughtful internet.
              </p>
              <span
                className={cn(
                  cursorClasses,
                  "[--cursor-color:#af67d2]",
                  "left-[-11%] top-[41%] [transform:rotate(-12deg)] max-[768px]:text-[8px] max-[768px]:py-[5px] max-[768px]:px-1.5 max-[768px]:left-[-6%]",
                )}
                aria-hidden="true"
              >
                Mia
              </span>
              <span
                className={cn(
                  cursorClasses,
                  "[--cursor-color:#087bea]",
                  "right-[-9%] top-[24%] [transform:rotate(-12deg)] max-[768px]:text-[8px] max-[768px]:py-[5px] max-[768px]:px-1.5 max-[768px]:right-[-4%]",
                )}
                aria-hidden="true"
              >
                Adam
              </span>
              <span
                className={cn(
                  cursorClasses,
                  "[--cursor-color:#249e70]",
                  "right-[18%] bottom-[-30%] [transform:rotate(-12deg)] max-[768px]:text-[8px] max-[768px]:py-[5px] max-[768px]:px-1.5 max-[768px]:bottom-[-19%]",
                )}
                aria-hidden="true"
              >
                Leo
              </span>
            </div>
            <span
              className={cn(
                handwrittenClasses,
                "absolute text-[#444746] text-[1.9cqw] left-[56%] top-[18%] [transform:rotate(-15deg)] dark:text-[#fff9e8] max-[768px]:text-[2.5cqw] leading-[1.15]",
              )}
              aria-hidden="true"
            >
              Better
              <br />
              ideas
              <br />
              together.
              <i />
            </span>
            <span
              className={cn(
                handwrittenClasses,
                "absolute text-[#444746] text-[1.9cqw] left-[77%] top-[24%] [transform:rotate(-17deg)] dark:text-[#fff9e8] max-[768px]:text-[2.5cqw] leading-[1.15]",
              )}
              aria-hidden="true"
            >
              A<br />
              kinder
              <br />
              internet.
              <br />
              Perhaps.
              <i />
            </span>
            <span
              className={cn(
                handwrittenClasses,
                "absolute text-[#444746] text-[1.9cqw] left-[81%] top-[75%] [transform:rotate(9deg)] [&_b]:text-[#d7b511]",
                "dark:text-[#fff9e8]",
                "max-[768px]:hidden",
                "leading-[1.15]",
              )}
              aria-hidden="true"
            >
              This feels
              <br />
              right. <b>✧</b>
            </span>
          </HeroMotion>
          <div
            className={cn(
              "relative w-[90%] max-w-[1320px] mt-[85px] mx-auto mb-0 pointer-events-none",
              "animate-[landing-copy-enter_850ms_ease-out_both] [&_h1]:m-0 [&_h1]:text-[clamp(72px,_7.6vw,_113px)]",
              "[&_h1]:font-[650] [&_h1]:tracking-[-0.077em] [&>p]:text-(--muted-ink) [&>p]:mt-[29px] [&>p]:mx-0 [&>p]:mb-6",
              "[&>p]:text-[clamp(18px,_2vw,_28px)] [&>p]:tracking-[-1px]",
              "max-[1200px]:mt-[75px] max-[1200px]:[&_h1]:text-[7.6vw] max-[1200px]:[&>p]:my-[22px] max-[1200px]:[&>p]:mx-0",
              "max-[1200px]:[&>p]:text-[2vw] max-[1200px]:[&>p]:tracking-[-0.6px]",
              "min-[768px]:max-[1024px]:mt-10 min-[768px]:max-[1024px]:[&>p]:text-[16px]",
              "min-[768px]:max-[1024px]:[&>p]:max-w-[395px]",
              "max-[768px]:mt-[42px] max-[768px]:mx-[22px] max-[768px]:mb-0 max-[768px]:w-[calc(100%_-_44px)]",
              "max-[768px]:[&_h1]:text-[clamp(49px,_11.8vw,_78px)] max-[768px]:[&_h1]:tracking-[-0.075em]",
              "max-[768px]:[&>p]:text-[18px] max-[768px]:[&>p]:max-w-[330px] max-[768px]:[&>p]:tracking-[-0.55px]",
              "max-[768px]:[&>p]:my-6 max-[768px]:[&>p]:mx-0",
              "max-[361px]:[&_h1]:text-[44px]",
              "[&_h1]:leading-[0.91]",
              "max-[768px]:[&_h1]:leading-[0.98] max-[768px]:[&>p]:leading-[1.5]",
            )}
          >
            <h1 id="hero-title">
              Good ideas
              <br />
              come together.
            </h1>
            <p>A thoughtful space to write, connect, and create. Together.</p>
            <div className="flex flex-wrap gap-4 pointer-events-auto w-fit max-[768px]:flex-col max-[768px]:items-start max-[768px]:gap-3">
              <StartWriting hero />
              <a
                className={cn(
                  "min-h-16 inline-flex items-center justify-center gap-[22px] py-0 px-7 rounded-[6px] text-[20px]",
                  "tracking-[-0.65px] [transition:background_160ms,_box-shadow_160ms] border border-[#aab0ba] text-(--muted-ink)",
                  "bg-[#faf9f65c] hover:bg-(--surface) hover:border-(--ink) hover:text-(--ink)",
                  "dark:bg-[#191a18a6]",
                  "max-[1200px]:text-[16px] max-[1200px]:min-h-[54px] max-[1200px]:py-0 max-[1200px]:px-[23px] max-[1200px]:gap-4",
                  "min-[768px]:max-[1024px]:py-0 min-[768px]:max-[1024px]:px-[17px] min-[768px]:max-[1024px]:min-h-[46px]",
                  "min-[768px]:max-[1024px]:text-[14px]",
                  "max-[768px]:min-h-[50px] max-[768px]:py-0 max-[768px]:px-[22px] max-[768px]:text-[16px]",
                  "leading-[1.2]",
                )}
                href="#experience"
              >
                Explore the experience
              </a>
            </div>
          </div>
          <a
            className={cn(
              "absolute left-[5.2%] bottom-[5.5%] flex flex-col items-start gap-[15px] text-[12px] text-(--muted-ink)",
              "uppercase font-bold tracking-[0.17em] [&_svg]:w-[23px] [&_svg]:h-10 [&_svg]:stroke-[1.2]",
              "[&_svg]:[transition:transform_180ms] [&:hover_svg]:[transform:translateY(5px)]",
              "max-[768px]:bottom-4 max-[768px]:left-[22px] max-[768px]:flex-row max-[768px]:items-center max-[768px]:gap-3",
              "max-[768px]:text-[9px] max-[768px]:[&_svg]:h-[26px] max-[768px]:[&_svg]:w-4",
            )}
            href="#collaboration"
          >
            Scroll to unfold
            <ArrowDown aria-hidden="true" />
          </a>
          <span
            className={cn(
              "absolute right-[3.5%] bottom-5 text-[#626566] text-[10px] tracking-[0.03em]",
              "dark:text-[#b8bebf]",
              "max-[768px]:text-[8px] max-[768px]:bottom-[26px] max-[768px]:right-5",
            )}
          >
            Collaboration, illustrated
          </span>
        </section>
        <Narrative />
        <div
          className={cn(
            "flex w-[93%] max-w-[1340px] items-center my-0 mx-auto gap-6 text-(--muted-ink) text-[12px] uppercase",
            "font-semibold tracking-[0.23em] before:content-[''] before:h-[1px] before:bg-(--line) before:flex-1",
            "after:content-[''] after:h-[1px] after:bg-(--line) after:flex-1",
            "max-[768px]:w-[calc(100%_-_40px)] max-[768px]:gap-[13px] max-[768px]:text-[8px] max-[768px]:tracking-[0.18em]",
          )}
        >
          <span>Made for the way ideas happen</span>
        </div>
        <section
          className={cn(
            "w-[92%] max-w-[1320px] grid grid-cols-[58%_1fr] items-center gap-12 mt-[92px] mx-auto mb-[60px]",
            "scroll-mt-[45px]",
            "max-[1200px]:gap-8 max-[1200px]:mt-[75px]",
            "min-[768px]:max-[1024px]:grid-cols-1 min-[768px]:max-[1024px]:w-[86%] min-[768px]:max-[1024px]:gap-[50px]",
            "max-[768px]:grid-cols-1 max-[768px]:w-[calc(100%_-_40px)] max-[768px]:gap-[52px] max-[768px]:mt-[50px]",
            "max-[768px]:mx-auto max-[768px]:mb-[70px] max-[768px]:scroll-mt-6",
          )}
          id="experience"
          aria-labelledby="feature-title"
        >
          <CollaborationDemo />
          <div
            className={cn(
              "relative pb-[60px] [&_h2]:text-[clamp(38px,_4.2vw,_61px)] [&_h2]:font-medium [&_h2]:tracking-[-0.075em]",
              "[&_h2]:mt-0 [&_h2]:mx-0 [&_h2]:mb-7",
              "max-[1200px]:pb-[38px] max-[1200px]:[&_h2]:text-[4.2vw]",
              "min-[768px]:max-[1024px]:pb-0 min-[768px]:max-[1024px]:[&_h2]:text-[56px]",
              "max-[768px]:pb-[84px] max-[768px]:[&_h2]:text-[clamp(40px,_10.7vw,_66px)] max-[768px]:[&_h2]:mb-[22px]",
              "[&_h2]:leading-[0.99]",
              "max-[768px]:[&_h2]:leading-[1.04]",
            )}
          >
            <h2 id="feature-title">
              Follow the thought.
              <br />
              Stay in the flow.
            </h2>
            <p
              className={cn(
                "text-[clamp(18px,_1.75vw,_25px)] tracking-[-0.75px] text-(--muted-ink) max-w-[490px] mt-0 mx-0 mb-8",
                "max-[1200px]:text-[18px] max-[1200px]:mb-[26px]",
                "min-[768px]:max-[1024px]:max-w-[470px] min-[768px]:max-[1024px]:text-[22px]",
                "max-[768px]:text-[18px] max-[768px]:tracking-[-0.45px] max-[768px]:mb-[26px] max-[768px]:max-w-[420px]",
                "leading-[1.45]",
                "max-[768px]:leading-[1.55]",
              )}
            >
              Write, refine, and explore ideas together
              <br className="max-[1200px]:hidden" /> in a space that feels as
              natural as a conversation, but keeps everything in one place.
            </p>
            <StartWriting />
            <p
              className={cn(
                handwrittenClasses,
                "absolute right-0 bottom-[-35px] text-(--muted-ink) text-[29px] [transform:rotate(-14deg)] m-0 [&_i]:ml-[38%]",
                "[&_i]:w-[40%]",
                "max-[1200px]:text-[23px] max-[1200px]:-bottom-10",
                "min-[768px]:max-[1024px]:right-[18px] min-[768px]:max-[1024px]:bottom-2.5",
                "max-[768px]:bottom-[-5px] max-[768px]:right-[5px] max-[768px]:text-[25px]",
                "leading-[1.15]",
              )}
              aria-hidden="true"
            >
              Better ideas
              <br />
              belong together.
              <i />
            </p>
          </div>
        </section>
      </main>
      <footer
        className={cn(
          "[&_nav_a]:[transition:color_160ms] [&_nav_a:hover]:text-(--ink) [&_nav_a:hover]:underline",
          "[&_nav_a:hover]:underline-offset-[5px] w-[93%] max-w-[1340px] my-0 mx-auto min-h-[130px] border-t",
          "border-t-(--line) flex items-center gap-12 [&_nav]:flex [&_nav]:items-center [&_nav]:gap-10 [&_nav]:ml-auto",
          "[&_nav]:text-(--muted-ink) [&_nav]:text-[16px] [&_nav_a]:inline-flex [&_nav_a]:gap-3 [&_nav_a]:items-center",
          "[&_nav_a]:min-h-11 [&_nav_svg]:w-[18px] [&_nav_svg]:text-[#b99500]",
          "max-[1200px]:min-h-[110px] max-[1200px]:gap-8 max-[1200px]:[&_nav]:text-[14px] max-[1200px]:[&_nav]:gap-7",
          "max-[768px]:w-[calc(100%_-_40px)] max-[768px]:flex-wrap max-[768px]:pt-[30px] max-[768px]:px-0",
          "max-[768px]:pb-[25px] max-[768px]:gap-6 max-[768px]:[&_nav]:ml-0 max-[768px]:[&_nav]:gap-8",
          "max-[768px]:[&_nav]:text-[13px] max-[768px]:[&_nav]:w-full",
          "max-[361px]:gap-4",
        )}
      >
        <Link href="/" aria-label="Softmaple home">
          <LandingBrand />
        </Link>
        <span
          className={cn(
            "pl-[45px] border-l border-l-(--muted-ink) text-[16px] text-(--muted-ink)",
            "max-[1200px]:text-[14px] max-[1200px]:pl-[30px]",
            "max-[768px]:border-0 max-[768px]:p-0 max-[768px]:text-[11px] max-[768px]:ml-auto",
            "max-[361px]:text-[10px]",
          )}
        >
          © {new Date().getFullYear()} Softmaple
        </span>
        <nav aria-label="Footer">
          <a href={SITE_CONFIG.GITHUB_REPO}>
            GitHub <ArrowUpRight aria-hidden="true" />
          </a>
          <a href={SITE_CONFIG.DOCS}>Docs</a>
        </nav>
      </footer>
    </div>
  );
}
