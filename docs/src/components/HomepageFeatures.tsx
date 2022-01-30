import React from "react";
import clsx from "clsx";
import styles from "./HomepageFeatures.module.css";

type FeatureItem = {
  title: string;
  image: string;
  description: JSX.Element;
};

const FeatureList: FeatureItem[] = [
  {
    title: "Data Security",
    image: "/img/undraw_docusaurus_mountain.svg",
    description: (
      <>SoftMaple editor stores your data in the browser localStorage.</>
    ),
  },
  {
    title: "Focus on What Matters",
    image: "/img/undraw_docusaurus_tree.svg",
    description: (
      <>
        Just type like Microsoft Word or Google Doc and SoftMaple will show you
        the results -- LaTeX source code.
      </>
    ),
  },
  {
    title: "Powered by Nextjs",
    image: "/img/undraw_docusaurus_react.svg",
    description: <>Fast rendering.</>,
  },
];

function Feature({ image, title, description }: FeatureItem) {
  return (
    <div className={clsx("col col--4")}>
      <div className="text--center">
        <img className={styles.featureSvg} alt={title} src={image} />
      </div>
      <div className="text--center padding-horiz--md">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): JSX.Element {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
