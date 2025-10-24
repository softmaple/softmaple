import { Button } from "@softmaple/ui/components/button";

export const CtaSection = () => {
  return (
    <section className="container mx-auto px-4 py-16 md:py-24">
      <div className="max-w-4xl mx-auto text-center">
        <div className="bg-gradient-to-r from-orange-500/10 to-red-500/10 border border-orange-500/20 rounded-2xl p-8 md:p-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Ready to transform your writing workflow?
          </h2>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Join thousands of researchers, engineers, and technical writers who
            trust Softmaple for their documentation needs.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="px-8 py-3 text-base font-medium">
              Start Writing Today
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="px-8 py-3 text-base font-medium"
            >
              View Examples
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};
