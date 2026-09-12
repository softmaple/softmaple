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
import styles from "./landing/landing.module.css";

function StartWriting() {
  return (
    <Link className={styles.primary} href="/signup">
      Start writing <ArrowRight aria-hidden="true" />
    </Link>
  );
}

export default function LandingPage() {
  return (
    <div className={styles.landing}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <main id="main">
        <section
          className={styles.hero}
          id="product"
          aria-labelledby="hero-title"
        >
          <LandingHeader />
          <HeroMotion>
            <Image
              className={styles.ribbon}
              src="/landing/paper-ribbon.webp"
              alt=""
              width={1448}
              height={1086}
              sizes="100vw"
              preload
            />
            <div className={styles.paperWords}>
              <p className={styles.paperEyebrow}>01 / NOTES</p>
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
                className={`${styles.cursor} ${styles.mia} ${styles.paperMia}`}
                aria-hidden="true"
              >
                Mia
              </span>
              <span
                className={`${styles.cursor} ${styles.adam} ${styles.paperAdam}`}
                aria-hidden="true"
              >
                Adam
              </span>
              <span
                className={`${styles.cursor} ${styles.leo} ${styles.paperLeo}`}
                aria-hidden="true"
              >
                Leo
              </span>
            </div>
            <span
              className={`${styles.handwritten} ${styles.noteOne}`}
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
              className={`${styles.handwritten} ${styles.noteTwo}`}
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
              className={`${styles.handwritten} ${styles.noteThree}`}
              aria-hidden="true"
            >
              This feels
              <br />
              right. <b>✧</b>
            </span>
          </HeroMotion>
          <div className={styles.heroCopy}>
            <h1 id="hero-title">
              Good ideas
              <br />
              come together.
            </h1>
            <p>A thoughtful space to write, connect, and create. Together.</p>
            <div className={styles.actions}>
              <StartWriting />
              <a className={styles.secondary} href="#experience">
                Explore the experience
              </a>
            </div>
          </div>
          <a className={styles.scrollCue} href="#collaboration">
            Scroll to unfold
            <ArrowDown aria-hidden="true" />
          </a>
          <span className={styles.heroDemoLabel}>
            Collaboration, illustrated
          </span>
        </section>
        <Narrative />
        <div className={styles.divider}>
          <span>Made for the way ideas happen</span>
        </div>
        <section
          className={styles.feature}
          id="experience"
          aria-labelledby="feature-title"
        >
          <CollaborationDemo />
          <div className={styles.featureCopy}>
            <h2 id="feature-title">
              Follow the thought.
              <br />
              Stay in the flow.
            </h2>
            <p>
              Write, refine, and explore ideas together
              <br className={styles.desktopBreak} /> in a space that feels as
              natural as a conversation, but keeps everything in one place.
            </p>
            <StartWriting />
            <p
              className={`${styles.handwritten} ${styles.featureNote}`}
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
      <footer className={styles.footer}>
        <Link href="/" aria-label="Softmaple home">
          <LandingBrand />
        </Link>
        <span className={styles.copyright}>
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
