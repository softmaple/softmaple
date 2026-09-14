import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-6 py-16">
      <Link className="text-sm underline underline-offset-4" href="/">
        Back home
      </Link>
      <h1 className="mt-12 font-serif text-5xl">Terms of Service</h1>
      <p className="mt-6 leading-7 text-muted-foreground">
        These terms describe the rules for using Softmaple.
      </p>
    </main>
  );
}
