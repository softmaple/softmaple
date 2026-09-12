import styles from "./landing.module.css";

export function MapleMark() {
  return (
    <svg viewBox="0 0 32 36" fill="currentColor" aria-hidden="true">
      <path d="m16 0 3.1 7.4 3.4-2-1 9 4.9-4.1.7 4.1 4.9-.7-2.6 5 2.1 1.9-9.7 7.1.8 4.1-5.7-1.2.4 5.4h-2.6l.4-5.4-5.7 1.2.8-4.1L.5 20.6l2.1-1.9-2.6-5 4.9.7.7-4.1 4.9 4.1-1-9 3.4 2L16 0Z" />
    </svg>
  );
}

export function LandingBrand() {
  return (
    <span className={styles.brand}>
      <MapleMark />
      <span>softmaple</span>
    </span>
  );
}
