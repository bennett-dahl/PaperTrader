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
    <main className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-6 w-6 text-emerald-400" />
          <span className="text-xl font-bold">PaperTrader</span>
        </div>
      </header>

      {/* Hero */}
      <section className="flex flex-col items-center text-center px-6 pt-16 pb-24 max-w-2xl mx-auto">
        <div className="inline-flex items-center gap-2 bg-emerald-400/10 text-emerald-400 text-sm font-medium px-3 py-1 rounded-full mb-6 border border-emerald-400/20">
          <Zap className="h-3.5 w-3.5" />
          Real market data. Zero real risk.
        </div>

        <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight mb-6">
          Learn to invest without{" "}
          <span className="text-emerald-400">losing a cent</span>
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
            className="bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold text-base px-8 py-6 h-auto rounded-xl w-full sm:w-auto"
          >
            Start Trading for Free →
          </Button>
        </form>

        <p className="text-slate-500 text-sm mt-4">
          Sign in with Google · No credit card · No real money
        </p>
      </section>

      {/* Features */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-4xl mx-auto px-6 pb-24">
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
            className="bg-slate-800/60 border border-slate-700 rounded-2xl p-6"
          >
            <Icon className="h-8 w-8 text-emerald-400 mb-4" />
            <h3 className="font-semibold text-lg mb-2">{title}</h3>
            <p className="text-slate-400 text-sm leading-relaxed">{desc}</p>
          </div>
        ))}
      </section>

      <footer className="text-center text-slate-600 text-xs pb-8">
        PaperTrader · Built for learning · Not financial advice
      </footer>
    </main>
  );
}
