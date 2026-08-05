import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@softmaple/ui/components/card";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  FilePenLine,
  Globe,
  Network,
  Sparkle,
  SplitSquareHorizontal,
  Users,
} from "lucide-react";

export const Route = createFileRoute("/")({ component: App });

interface DemoCard {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly description: string;
  readonly link: string;
  readonly badge?: string;
}

const demos: ReadonlyArray<DemoCard> = [
  {
    icon: <FilePenLine className="w-12 h-12 text-cyan-400" />,
    title: "Lexical × EG-walker",
    description:
      "Rich-text collaboration with Lexical, block-model CRDT, WebSocket document sync, and live presence. Open the same room in two browsers to verify.",
    link: "/demo/lexical-eg-walker",
    badge: "WebSocket",
  },
  {
    icon: <Globe className="w-12 h-12 text-cyan-400" />,
    title: "Online Collaborative Editor",
    description:
      "Create or join rooms and sync plain-text editing over WebSocket. Share the room link to collaborate across browsers.",
    link: "/demo/online-collab-editor",
    badge: "WebSocket",
  },
  {
    icon: <Sparkle className="w-12 h-12 text-cyan-400" />,
    title: "Awareness + Eg-Walker",
    description:
      "Pick a Pokémon trainer and collaborate with live cursors, selection highlights, and presence indicators from @softmaple/awareness.",
    link: "/demo/awareness-collab",
  },
  {
    icon: <Users className="w-12 h-12 text-cyan-400" />,
    title: "Collaborative Editor",
    description:
      "Side-by-side text editors powered by the Eg-Walker CRDT. Type in either panel to see instant local synchronization.",
    link: "/demo/collaborative-editor",
  },
  {
    icon: <SplitSquareHorizontal className="w-12 h-12 text-cyan-400" />,
    title: "Two-Panel Editor Demo",
    description:
      "Independent text editors side-by-side. Useful for comparing drafts, note-taking, or dual-language editing.",
    link: "/demo/two-panel-editor",
  },
];

function App() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      <section className="relative py-20 px-6 text-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 via-sky-500/10 to-blue-500/10" />
        <div className="relative max-w-5xl mx-auto">
          <div className="flex items-center justify-center gap-6 mb-6">
            <div className="w-24 h-24 md:w-32 md:h-32 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/30">
              <Network
                className="w-12 h-12 md:w-16 md:h-16 text-white"
                aria-hidden
              />
            </div>
            <h1 className="text-6xl md:text-7xl font-black text-white [letter-spacing:-0.08em]">
              <span className="text-gray-300">SOFTMAPLE</span>{" "}
              <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                PLAYGROUND
              </span>
            </h1>
          </div>
          <p className="text-2xl md:text-3xl text-gray-300 mb-4 font-light">
            Try SoftMaple collaboration live
          </p>
          <p className="text-lg text-gray-400 max-w-3xl mx-auto mb-8">
            Interactive demos for CRDT sync, rich-text editing, presence, and
            WebSocket rooms — open a demo, share the room link, and collaborate.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/demo/lexical-eg-walker"
              className="px-8 py-3 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-lg transition-colors shadow-lg shadow-cyan-500/50"
            >
              Open Lexical demo
            </Link>
            <a
              href="https://docs.softmaple.ink"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-3 border border-slate-600 hover:border-cyan-500/60 text-gray-200 font-semibold rounded-lg transition-colors"
            >
              Documentation
            </a>
          </div>
        </div>
      </section>

      <section className="py-16 px-6 max-w-7xl mx-auto">
        <div className="mb-10 max-w-2xl">
          <h2 className="text-2xl font-semibold text-white mb-2">Demos</h2>
          <p className="text-gray-400">
            Start with Lexical × EG-walker for cross-browser rich-text sync, or
            explore the other collaboration experiments below.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {demos.map((demo) => (
            <Card
              key={demo.title}
              className="bg-slate-800/50 border-slate-700 hover:bg-slate-800/70 hover:border-cyan-500/50 transition-all duration-200 cursor-pointer group"
            >
              <Link to={demo.link} className="block h-full">
                <CardHeader>
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="group-hover:scale-110 transition-transform duration-200">
                      {demo.icon}
                    </div>
                    {demo.badge ? (
                      <span className="shrink-0 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-xs font-medium text-cyan-300">
                        {demo.badge}
                      </span>
                    ) : null}
                  </div>
                  <CardTitle className="text-white text-xl">
                    {demo.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-400 leading-relaxed">
                    {demo.description}
                  </p>
                </CardContent>
              </Link>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
