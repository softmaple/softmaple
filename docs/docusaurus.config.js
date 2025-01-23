// @ts-check
// Note: type annotations allow type checking and IDEs autocompletion

const lightCodeTheme = require("prism-react-renderer/themes/github");
const darkCodeTheme = require("prism-react-renderer/themes/dracula");

// Netlify apps
const mainSiteUrl = "https://docs.softmaple.ink/";
const editorPageUrl = "https://softmaple.ink";
const insightsPageUrl = "https://insights.softmaple.ink/";
// additional pages
const blogPageUrl = "https://blog.softmaple.ink/";

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "SoftMaple",
  tagline: "It's cool",
  url: mainSiteUrl,
  baseUrl: "/",
  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",
  favicon: "img/favicon.ico",
  organizationName: "SoftMaple", // Usually your GitHub org/user name.
  projectName: "docs", // Usually your repo name.

  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: require.resolve("./sidebars.js"),
          // Please change this to your repo.
          editUrl: ({ versionDocsDirPath, docPath }) => {
            return `https://github.com/softmaple/softmaple/edit/main/docs/${versionDocsDirPath}/${docPath}`;
          },
        },
        blog: {
          showReadingTime: true,
          // Please change this to your repo.
          editUrl: ({ blogDirPath, blogPath }) => {
            return `https://github.com/softmaple/softmaple/edit/main/docs/${blogDirPath}/${blogPath}`;
          },
        },
        theme: {
          customCss: require.resolve("./src/css/custom.css"),
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      announcementBar: {
        id: "announcementBar-2", // Increment on change
        content: `Try it <a target="_blank" rel="noopener noreferrer" href=${editorPageUrl}>now</a>!&nbsp;⭐️ If you like SoftMaple, give it a star on <a target="_blank" rel="noopener noreferrer" href="https://github.com/softmaple/softmaple">GitHub</a>.`,
      },
      navbar: {
        title: "SoftMaple",
        // logo: {
        //   alt: 'SoftMaple Logo',
        //   src: 'img/logo.svg',
        // },
        items: [
          {
            to: "docs/get-started",
            activeBasePath: "docs",
            label: "Docs",
            position: "left",
          },
          { to: "/blog", label: "Blog", position: "left" },
          {
            href: insightsPageUrl,
            label: "Insights",
            position: "left",
          },
          {
            href: "https://github.com/softmaple/softmaple",
            position: "right",
            className: "header-github-link",
            "aria-label": "GitHub repository",
          },
        ],
      },
      footer: {
        style: "dark",
        links: [
          {
            title: "Docs",
            items: [
              {
                label: "Get Started",
                to: "/docs/get-started",
              },
            ],
          },
          {
            title: "Community",
            items: [
              {
                label: "Discord",
                href: "https://discord.gg/Vwsuqq7dQD",
              },
              {
                label: "Twitter",
                href: "https://twitter.com/Tom61319231",
              },
            ],
          },
          {
            title: "More",
            items: [
              {
                label: "Blog",
                to: "/blog",
              },
              {
                label: "GitHub",
                href: "https://github.com/softmaple/softmaple",
              },
              {
                label: "Hashnode",
                href: blogPageUrl,
              },
            ],
          },
          {
            title: "Acknowledgements",
            items: [
              {
                html: `
              <a href="https://www.netlify.com"> <img src="https://www.netlify.com/v3/img/components/netlify-color-accent.svg" alt="Deploys by Netlify" /> </a>`,
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} SoftMaple, Inc. Built with Docusaurus.`,
      },
      prism: {
        theme: lightCodeTheme,
        darkTheme: darkCodeTheme,
      },
    }),

  customFields: {
    editorPageUrl,
  },
};

module.exports = config;
