"use client";

import { Button } from "@softmaple/ui/components/button";
import Link from "next/link";
import { FileText } from "lucide-react";
import { GitHubIcon } from "./icons/github";
import { XIcon } from "./icons/x";

const socialLinks = [
  { key: "github", href: "https://github.com/softmaple", icon: GitHubIcon },
  { key: "x", href: "https://x.com/zhyd007", icon: XIcon },
];

const footerSections = [
  {
    key: "product",
    title: "Product",
    links: [
      { key: "features", href: "#", label: "Features" },
      { key: "pricing", href: "#", label: "Pricing" },
      { key: "changelog", href: "#", label: "Changelog" },
      { key: "roadmap", href: "#", label: "Roadmap" },
    ],
  },
  {
    key: "resources",
    title: "Resources",
    links: [
      { key: "documentation", href: "#", label: "Documentation" },
      { key: "tutorials", href: "#", label: "Tutorials" },
      { key: "examples", href: "#", label: "Examples" },
      { key: "community", href: "#", label: "Community" },
    ],
  },
  {
    key: "company",
    title: "Company",
    links: [
      { key: "about", href: "#", label: "About" },
      { key: "blog", href: "#", label: "Blog" },
      { key: "careers", href: "#", label: "Careers" },
      { key: "contact", href: "#", label: "Contact" },
    ],
  },
];

export const Footer = () => {
  return (
    <footer className="border-t border-border/40 bg-muted/30">
      <div className="container mx-auto px-4 py-12">
        <div className="grid md:grid-cols-4 gap-8">
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <span className="font-semibold text-xl">Softmaple</span>
            </div>
            <p className="text-sm text-muted-foreground">
              The modern writing tool for technical professionals.
            </p>
            <div className="flex space-x-4">
              {socialLinks.map((social) => (
                <Button
                  key={social.key}
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8"
                  asChild
                >
                  <Link href={social.href}>
                    <social.icon className="w-4 h-4" />
                  </Link>
                </Button>
              ))}
            </div>
          </div>

          {footerSections.map((section) => (
            <div key={section.key}>
              <h3 className="font-semibold mb-4">{section.title}</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {section.links.map((link) => (
                  <li key={link.key}>
                    <Link
                      href={link.href}
                      className="hover:text-foreground transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-border/40 mt-12 pt-8 text-center text-sm text-muted-foreground">
          <p>
            &copy; {new Date().getFullYear()} Softmaple. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};
