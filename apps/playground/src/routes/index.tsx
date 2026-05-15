import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@softmaple/ui/components/card";
import { createFileRoute } from "@tanstack/react-router";
import {
  Globe,
  Route as RouteIcon,
  Server,
  Shield,
  Sparkle,
  Sparkles,
  SplitSquareHorizontal,
  Users,
  Waves,
  Zap,
} from "lucide-react";

export const Route = createFileRoute("/")({ component: App });

interface Feature {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly description: string;
  readonly link: string;
  readonly external?: boolean;
}

function App() {
  const features: ReadonlyArray<Feature> = [
    {
      icon: <SplitSquareHorizontal className="w-12 h-12 text-cyan-400" />,
      title: "Two-Panel Editor Demo",
      description:
        "Independent text editors side-by-side. Perfect for comparing, note-taking, or dual-language editing.",
      link: "/demo/two-panel-editor",
    },
    {
      icon: <Users className="w-12 h-12 text-cyan-400" />,
      title: "Collaborative Editor",
      description:
        "Real-time collaborative text editing powered by Eg-Walker CRDT algorithm. Type in either editor to see instant synchronization.",
      link: "/demo/collaborative-editor",
    },
    {
      icon: <Globe className="w-12 h-12 text-cyan-400" />,
      title: "Online Collaborative Editor",
      description:
        "Create or join rooms to collaborate with multiple users in real-time. Share room links for instant collaboration.",
      link: "/demo/online-collab-editor",
    },
    {
      icon: <Sparkle className="w-12 h-12 text-cyan-400" />,
      title: "Awareness + Eg-Walker",
      description:
        "Pick a Pokémon trainer and collaborate with live cursors, selection highlights, and presence indicators powered by the @softmaple/awareness package.",
      link: "/demo/awareness-collab",
    },
    {
      icon: <Zap className="w-12 h-12 text-cyan-400" />,
      title: "Powerful Server Functions",
      description:
        "Write server-side code that seamlessly integrates with your client components. Type-safe, secure, and simple.",
      link: "https://tanstack.com/start",
      external: true,
    },
    {
      icon: <Server className="w-12 h-12 text-cyan-400" />,
      title: "Flexible Server Side Rendering",
      description:
        "Full-document SSR, streaming, and progressive enhancement out of the box. Control exactly what renders where.",
      link: "https://tanstack.com/start",
      external: true,
    },
    {
      icon: <RouteIcon className="w-12 h-12 text-cyan-400" />,
      title: "API Routes",
      description:
        "Build type-safe API endpoints alongside your application. No separate backend needed.",
      link: "https://tanstack.com/start",
      external: true,
    },
    {
      icon: <Shield className="w-12 h-12 text-cyan-400" />,
      title: "Strongly Typed Everything",
      description:
        "End-to-end type safety from server to client. Catch errors before they reach production.",
      link: "https://tanstack.com/start",
      external: true,
    },
    {
      icon: <Waves className="w-12 h-12 text-cyan-400" />,
      title: "Full Streaming Support",
      description:
        "Stream data from server to client progressively. Perfect for AI applications and real-time updates.",
      link: "https://tanstack.com/start",
      external: true,
    },
    {
      icon: <Sparkles className="w-12 h-12 text-cyan-400" />,
      title: "Next Generation Ready",
      description:
        "Built from the ground up for modern web applications. Deploy anywhere JavaScript runs.",
      link: "https://tanstack.com/start",
      external: true,
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      <section className="relative py-20 px-6 text-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-purple-500/10"></div>
        <div className="relative max-w-5xl mx-auto">
          <div className="flex items-center justify-center gap-6 mb-6">
            <div className="w-24 h-24 md:w-32 md:h-32 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
              <span className="text-white font-bold text-4xl md:text-5xl">
                S
              </span>
            </div>
            <h1 className="text-6xl md:text-7xl font-black text-white [letter-spacing:-0.08em]">
              <span className="text-gray-300">SOFTMAPLE</span>{" "}
              <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                PLAYGROUND
              </span>
            </h1>
          </div>
          <p className="text-2xl md:text-3xl text-gray-300 mb-4 font-light">
            Interactive demos and experimentation space
          </p>
          <p className="text-lg text-gray-400 max-w-3xl mx-auto mb-8">
            Explore and test SoftMaple's features including collaborative
            editing, CRDT algorithms, and real-time synchronization. Built with
            TanStack Start.
          </p>
          <div className="flex flex-col items-center gap-4">
            <a
              href="https://docs.softmaple.ink"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-3 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-lg transition-colors shadow-lg shadow-cyan-500/50"
            >
              Documentation
            </a>
            <p className="text-gray-400 text-sm mt-2">
              Explore the demos below or start by editing{" "}
              <code className="px-2 py-1 bg-slate-700 rounded text-cyan-400">
                /src/routes/index.tsx
              </code>
            </p>
          </div>
        </div>
      </section>

      <section className="py-16 px-6 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature) => (
            <Card
              key={feature.title}
              className="bg-slate-800/50 border-slate-700 hover:bg-slate-800/70 hover:border-cyan-500/50 transition-all duration-200 cursor-pointer group"
            >
              <a
                href={feature.link}
                target={feature.external ? "_blank" : "_self"}
                rel={feature.external ? "noopener noreferrer" : undefined}
                className="block h-full"
              >
                <CardHeader>
                  <div className="mb-4 group-hover:scale-110 transition-transform duration-200">
                    {feature.icon}
                  </div>
                  <CardTitle className="text-white text-xl">
                    {feature.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-400 leading-relaxed">
                    {feature.description}
                  </p>
                </CardContent>
              </a>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
