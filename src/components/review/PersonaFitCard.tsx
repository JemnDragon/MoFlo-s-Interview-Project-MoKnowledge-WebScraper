"use client";

import { useState } from "react";
import type { PersonaFitInsight } from "@/lib/mock/placeholders";

/**
 * Testimonials vs. stated persona — the output of prompt 3.
 *
 * Surfaced as a standalone insight, not stored as a KnowledgeBase field: it is an
 * observation about the record rather than a property of the company.
 *
 * It runs on the *resolved* Ideal Customer Persona text, which is a genuine
 * pipeline-ordering dependency — until that field has been reviewed there is
 * nothing but a placeholder to compare against, and the card says so instead of
 * producing a comparison of a placeholder against real quotes.
 */
export function PersonaFitCard({
  personaText,
  testimonialCount,
}: {
  personaText: string | null;
  testimonialCount: number;
}) {
  const [insight, setInsight] = useState<PersonaFitInsight | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/insights/persona-fit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaText, testimonialCount }),
      });
      const body = (await response.json()) as { insight: PersonaFitInsight };
      setInsight(body.insight);
    } finally {
      setLoading(false);
    }
  };

  const tone: Record<PersonaFitInsight["alignment"], string> = {
    aligned: "bg-good-100 text-good-600",
    partial: "bg-mock-100 text-mock-600",
    diverged: "bg-danger-100 text-danger-600",
    insufficient_data: "bg-ink-100 text-ink-500",
  };

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink-900">
          Stated customers vs. actual customers
        </h3>
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="rounded border border-ink-200 px-2 py-1 text-xs font-medium text-accent-600 hover:border-accent-500 disabled:text-ink-400"
        >
          {loading ? "Running…" : insight ? "Run again" : "Run comparison"}
        </button>
      </div>

      <p className="hint mt-1">
        Compares the resolved Ideal Customer Persona against the {testimonialCount} testimonial
        {testimonialCount === 1 ? "" : "s"} on file. Not a stored field — an insight about the data.
      </p>

      {insight && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone[insight.alignment]}`}
            >
              {insight.alignment.replace(/_/g, " ")}
            </span>
            <span className="hint">confidence: {insight.confidence}</span>
            {insight.isMock && (
              <span className="rounded-full bg-mock-100 px-2 py-0.5 text-[11px] font-semibold text-mock-600">
                Mock output
              </span>
            )}
          </div>
          <ul className="space-y-1.5">
            {insight.observations.map((observation, index) => (
              <li key={index} className="text-xs leading-relaxed text-ink-700">
                {observation}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
