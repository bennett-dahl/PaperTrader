import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { signIn } from "@/auth";
import { TrendingUp, Shield, Zap, BarChart3 } from "lucide-react";

export default async function LandingPage() {
  const session = await auth();

  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="relative min-h-screen text-foreground overflow-hidden">
      {/* Header */}
      <header className="relative flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-400/10 shadow-glow-sm">
            <TrendingUp className="h-5 w-5 text-emerald-400" />
          </span>
          <span className="text-lg font-semibold tracking-tight text-gradient">PaperTrader</span>
        </div>
      </header>

      {/* Hero */}
      <section className="relative flex flex-col items-center text-center px-6 pt-16 pb-24 max-w-2xl mx-auto">
        <div className="inline-flex items-center gap-2 glass text-emerald-400 text-sm font-medium px-3 py-1 rounded-full mb-6 shadow-glow-sm">
          <Zap className="h-3.5 w-3.5" />
          Real market data. Zero real risk.
        </div>

        <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight leading-[1.05] mb-6">
          Learn to invest without{" "}
          <span className="text-gradient">losing a cent</span>
        </h1>

        <p className="text-slate-400 text-lg mb-10 leading-relaxed">
          PaperTrader gives you $5,000 in virtual cash to practice buying and
          selling stocks with real market prices. Build your strategy, track your
          portfolio, and get good before you go live.
        </p>

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/dashboard" });
          }}
        >
          <Button
            type="submit"
            size="lg"
            className="bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold text-base px-8 py-6 h-auto rounded-2xl w-full sm:w-auto shadow-glow"
          >
            Start Trading for Free →
          </Button>
        </form>

        <p className="text-slate-500 text-sm mt-4">
          Sign in with Google · No credit card · No real money
        </p>
      </section>

      {/* Features */}
      <section className="relative grid grid-cols-1 sm:grid-cols-3 gap-5 max-w-4xl mx-auto px-6 pb-24">
        {[
          {
            icon: Shield,
            title: "Risk-Free Practice",
            desc: "Start with $5,000 in virtual cash. Lose it all learning — then try again. No consequences, all upside.",
          },
          {
            icon: TrendingUp,
            title: "Real Market Prices",
            desc: "Quotes pulled from live market data via Finnhub. What you see is what the market sees.",
          },
          {
            icon: BarChart3,
            title: "Track Your Performance",
            desc: "Watch your portfolio grow (or shrink). Charts, P&L, transaction history — the full picture.",
          },
        ].map(({ icon: Icon, title, desc }) => (
          <div
            key={title}
            className="glass rounded-3xl p-6 transition-transform hover:-translate-y-1"
          >
            <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-400/10 shadow-glow-sm">
              <Icon className="h-6 w-6 text-emerald-400" />
            </span>
            <h3 className="font-semibold text-lg mb-2 tracking-tight">{title}</h3>
            <p className="text-slate-400 text-sm leading-relaxed">{desc}</p>
          </div>
        ))}
      </section>

      <footer className="relative text-center text-slate-600 text-xs pb-8">
        PaperTrader · Built for learning · Not financial advice
      </footer>
    </main>
  );
}
