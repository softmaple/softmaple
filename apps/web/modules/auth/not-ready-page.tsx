import { Button } from "@softmaple/ui/components/button";
import { Input } from "@softmaple/ui/components/input";
import { Card, CardContent } from "@softmaple/ui/components/card";
import { Badge } from "@softmaple/ui/components/badge";
import { CheckCircle, Clock, Mail, Zap, Shield, Users } from "lucide-react";

export default function NotReadyPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <Zap className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-lg">Softmaple</span>
          </div>
          <Badge variant="secondary" className="gap-1">
            <Clock className="w-3 h-3" />
            In Development
          </Badge>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          {/* Hero Section */}
          <div className="space-y-4">
            <Badge variant="outline" className="gap-2 px-3 py-1">
              <Clock className="w-3 h-3" />
              Coming Soon
            </Badge>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
              We're building something
              <span className="text-primary"> amazing</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Our SaaS platform is currently in development. We're working hard
              to bring you the best experience possible. Sign up to be notified
              when we launch.
            </p>
          </div>

          {/* Email Signup */}
          <Card className="max-w-md mx-auto">
            <CardContent className="p-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="font-semibold">Get notified when we launch</h3>
                  <p className="text-sm text-muted-foreground">
                    Be the first to know when we're ready for you.
                  </p>
                </div>
                <form className="space-y-3">
                  <Input
                    type="email"
                    placeholder="Enter your email address"
                    className="w-full"
                  />
                  {/* TODO: enable it when backend is ready */}
                  <Button disabled className="w-full gap-2">
                    <Mail className="w-4 h-4" />
                    Notify Me
                  </Button>
                </form>
                <p className="text-xs text-muted-foreground">
                  No spam, unsubscribe at any time.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Features Preview */}
          <div className="space-y-8 pt-8">
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold">What we're building</h2>
              <p className="text-muted-foreground">
                Here's a preview of what you can expect when we launch.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6 max-w-3xl mx-auto">
              <Card className="text-left">
                <CardContent className="p-6 space-y-3">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Zap className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="font-semibold">Lightning Fast</h3>
                  <p className="text-sm text-muted-foreground">
                    Built for speed and performance with modern technologies.
                  </p>
                </CardContent>
              </Card>

              <Card className="text-left">
                <CardContent className="p-6 space-y-3">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Shield className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="font-semibold">Secure & Reliable</h3>
                  <p className="text-sm text-muted-foreground">
                    Enterprise-grade security with 99.9% uptime guarantee.
                  </p>
                </CardContent>
              </Card>

              <Card className="text-left">
                <CardContent className="p-6 space-y-3">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Users className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="font-semibold">Team Collaboration</h3>
                  <p className="text-sm text-muted-foreground">
                    Seamless collaboration tools for teams of any size.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Development Progress */}
          <div className="space-y-6 pt-8">
            <h2 className="text-2xl font-semibold">Development Progress</h2>
            <Card className="max-w-2xl mx-auto">
              <CardContent className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    <span className="text-sm">Core architecture completed</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    <span className="text-sm">User authentication system</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Clock className="w-5 h-5 text-yellow-500" />
                    <span className="text-sm">Dashboard and main features</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Clock className="w-5 h-5 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Beta testing phase
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Clock className="w-5 h-5 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Public launch
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Timeline */}
          <div className="space-y-4 pt-8">
            <Badge variant="outline" className="gap-2">
              <Clock className="w-3 h-3" />
              Expected Launch: Q2 2025
            </Badge>
            <p className="text-sm text-muted-foreground">
              We're targeting a launch in the second quarter of 2025. Join our
              waitlist to get early access.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/40 mt-16">
        <div className="container mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-primary rounded-md flex items-center justify-center">
                <Zap className="w-3 h-3 text-primary-foreground" />
              </div>
              <span className="font-medium">Softmaple</span>
            </div>
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} Softmaple. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
