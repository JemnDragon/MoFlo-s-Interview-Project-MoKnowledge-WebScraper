"use client";

import type { KnowledgeBaseSummary } from "@/lib/db/types";

/**
 * Dense comparison table — desktop only.
 *
 * Not rendered at all below the mobile breakpoint; the view-mode selector removes
 * the option rather than this component trying to reflow ten columns onto a
 * phone. See ViewModeSelector for the reasoning.
 */
export function TableView({
  items,
  onOpen,
}: {
  items: KnowledgeBaseSummary[];
  onOpen: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm font-semibold text-ink-700">No knowledge bases match</p>
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-ink-200 bg-ink-50">
            {[
              "Company",
              "Industry",
              "Website",
              "Founded",
              "Languages",
              "Offerings",
              "Key people",
              "Complete",
              "Updated",
              "Status",
              "",
            ].map((heading) => (
              <th
                key={heading}
                scope="col"
                className="whitespace-nowrap px-3 py-2 font-semibold text-ink-700"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className={`border-b border-ink-100 last:border-b-0 ${
                item.status === "soft_deleted" ? "opacity-55" : "hover:bg-ink-50"
              }`}
            >
              <td className="px-3 py-2 font-semibold text-ink-900">{item.companyName}</td>
              <td className="px-3 py-2 text-ink-700">
                {item.industry ?? <span className="text-ink-400">—</span>}
              </td>
              <td className="max-w-[220px] truncate px-3 py-2">
                <a
                  href={item.website}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-accent-600 underline decoration-dotted"
                >
                  {item.website.replace(/^https?:\/\//, "")}
                </a>
              </td>
              <td className="px-3 py-2 text-ink-700">
                {item.yearFounded ?? <span className="text-ink-400">—</span>}
              </td>
              <td className="px-3 py-2 text-ink-700">
                {item.siteLanguage.length > 0 ? (
                  item.siteLanguage.slice(0, 3).join(", ").toUpperCase()
                ) : (
                  <span className="text-ink-400">—</span>
                )}
                {item.siteLanguage.length > 3 && ` +${item.siteLanguage.length - 3}`}
              </td>
              <td className="px-3 py-2 tabular-nums text-ink-700">{item.offeringsCount}</td>
              <td className="px-3 py-2 tabular-nums text-ink-700">{item.keyPeopleCount}</td>
              <td className="px-3 py-2 tabular-nums font-semibold text-ink-700">
                {item.completenessScore}%
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-ink-500">
                {new Date(item.updatedAt).toLocaleDateString()}
              </td>
              <td className="px-3 py-2">
                {item.status === "soft_deleted" ? (
                  <span className="rounded-full bg-hidden-100 px-1.5 py-0.5 text-[10px] font-semibold text-hidden-600">
                    Deleted
                  </span>
                ) : (
                  <span className="rounded-full bg-good-100 px-1.5 py-0.5 text-[10px] font-semibold text-good-600">
                    Active
                  </span>
                )}
              </td>
              <td className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => onOpen(item.id)}
                  className="font-semibold text-accent-600 hover:underline"
                >
                  Open
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
