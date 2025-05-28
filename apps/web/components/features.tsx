"use client";

import { Card, CardContent } from "@softmaple/ui/components/card";
import { FileText, Users, Zap } from "lucide-react";

export const Features = () => {
  return (
    <section id="features" className="container mx-auto px-4 py-16 md:py-24">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Built for modern technical writing
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Everything you need to create, collaborate, and publish technical
            documents with confidence.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:bg-card/80 transition-all duration-300 group">
            <CardContent className="p-8">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                <Users className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-3">
                Real-time Collaboration
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                Work together seamlessly with your team. See changes instantly,
                leave comments, and track revisions in real-time.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:bg-card/80 transition-all duration-300 group">
            <CardContent className="p-8">
              <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Instant Preview</h3>
              <p className="text-muted-foreground leading-relaxed">
                See your LaTeX and Markdown output in real-time. What you see is
                what you get, with perfect formatting every time.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:bg-card/80 transition-all duration-300 group">
            <CardContent className="p-8">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-3">
                AI-Powered Suggestions
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                Get intelligent writing suggestions, formula completions, and
                formatting recommendations powered by OpenAI.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
};
