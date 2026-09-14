import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-6 py-16">
      <Link className="text-sm underline underline-offset-4" href="/">
        Back home
      </Link>
      <h1 className="mt-12 font-serif text-5xl">Privacy Policy</h1>
      <p className="mt-6 leading-7 text-muted-foreground">
        We use your account information to provide Softmaple and keep your
        workspace secure.
      </p>
    </main>
  );
}
