import { createFileRoute } from "@tanstack/react-router";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@softmaple/ui/components/card";
import {
  Zap,
  Server,
  Route as RouteIcon,
  Shield,
  Waves,
  Sparkles,
  SplitSquareHorizontal,
  Users,
} from "lucide-react";

export const Route = createFileRoute("/")({ component: App });

function App() {
  const features = [
    {
      icon: <SplitSquareHorizontal className="w-12 h-12 text-cyan-400" />,
      title: "Two-Panel Text Editor",
      description:
        "Independent text editors side-by-side. Perfect for comparing, note-taking, or dual-language editing.",
      link: "/demo/two-panel-editor",
    },
    {
      icon: <Users className="w-12 h-12 text-cyan-400" />,
      title: "Collaborative Text Editor",
      description:
        "Real-time collaborative text editing powered by Eg-Walker CRDT algorithm. Type in either editor to see instant synchronization.",
      link: "/demo/collaborative-editor",
    },
    {
      icon: <Zap className="w-12 h-12 text-cyan-400" />,
      title: "Powerful Server Functions",
      description:
        "Write server-side code that seamlessly integrates with your client components. Type-safe, secure, and simple.",
      link: undefined,
    },
    {
      icon: <Server className="w-12 h-12 text-cyan-400" />,
      title: "Flexible Server Side Rendering",
      description:
        "Full-document SSR, streaming, and progressive enhancement out of the box. Control exactly what renders where.",
      link: undefined,
    },
    {
      icon: <RouteIcon className="w-12 h-12 text-cyan-400" />,
      title: "API Routes",
      description:
        "Build type-safe API endpoints alongside your application. No separate backend needed.",
      link: undefined,
    },
    {
      icon: <Shield className="w-12 h-12 text-cyan-400" />,
      title: "Strongly Typed Everything",
      description:
        "End-to-end type safety from server to client. Catch errors before they reach production.",
      link: undefined,
    },
    {
      icon: <Waves className="w-12 h-12 text-cyan-400" />,
      title: "Full Streaming Support",
      description:
        "Stream data from server to client progressively. Perfect for AI applications and real-time updates.",
      link: undefined,
    },
    {
      icon: <Sparkles className="w-12 h-12 text-cyan-400" />,
      title: "Next Generation Ready",
      description:
        "Built from the ground up for modern web applications. Deploy anywhere JavaScript runs.",
      link: undefined,
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      <section className="relative py-20 px-6 text-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-purple-500/10"></div>
        <div className="relative max-w-5xl mx-auto">
          <div className="flex items-center justify-center gap-6 mb-6">
            <img
              src="/tanstack-circle-logo.png"
              alt="SoftMaple logo"
              className="w-24 h-24 md:w-32 md:h-32"
            />
            <h1 className="text-6xl md:text-7xl font-black text-white [letter-spacing:-0.08em]">
              SoftMaple Playground
            </h1>
          </div>
          <p className="text-2xl md:text-3xl text-gray-300 mb-4 font-light">
            Your playground for collaborative text editing experiments.
          </p>
          <p className="text-lg text-gray-400 max-w-3xl mx-auto mb-8">
            Explore two synchronized editor experiences built with TanStack
            Router and SoftMaple UI components.
          </p>
          <div className="flex flex-col items-center gap-4">
            <a
              href="https://tanstack.com/start"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-3 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-lg transition-colors shadow-lg shadow-cyan-500/50"
            >
              Documentation
            </a>
            <p className="text-gray-400 text-sm mt-2">
              Begin your SoftMaple Playground journey by editing{" "}
              <code className="px-2 py-1 bg-slate-700 rounded text-cyan-400">
                /src/routes/index.tsx
              </code>
            </p>
          </div>
        </div>
      </section>

      <section className="py-16 px-6 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <Card
              key={index}
              className="cursor-pointer hover:shadow-lg transition-shadow"
            >
              <a
                href={feature.link || "https://tanstack.com/start"}
                target={feature.link ? "_self" : "_blank"}
                rel={feature.link ? undefined : "noopener noreferrer"}
                className="block"
              >
                <CardHeader>
                  <div className="mb-4">{feature.icon}</div>
                  <CardTitle>
                    <h2 className="text-xl font-semibold leading-snug">
                      {feature.title}
                    </h2>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground leading-relaxed">
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
