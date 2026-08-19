"use client";

import { useState } from "react";

/**
 * Profile-level delete.
 *
 * The soft/hard choice is made at delete time rather than being a setting
 * somewhere, because it is a decision about this specific record. Hard delete
 * gets a stronger confirmation — typing the word — because it is the one action
 * in the product with no path back.
 *
 * Section-level delete is a different, smaller control that lives inside each
 * category block and is soft-only. See CategoryGroupBlock.
 */
export function DeleteControls({
  deleted,
  onDelete,
  onRestore,
}: {
  deleted: boolean;
  onDelete: (mode: "soft" | "hard") => void;
  onRestore: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  if (deleted) {
    return (
      <button
        type="button"
        onClick={onRestore}
        className="rounded border border-good-600/40 px-2.5 py-1 text-xs font-semibold text-good-600 hover:bg-good-100"
      >
        Restore profile
      </button>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-danger-600/40 px-2.5 py-1 text-xs font-semibold text-danger-600 hover:bg-danger-100"
      >
        Delete profile
      </button>
    );
  }

  return (
    <div className="w-full max-w-md rounded-lg border border-danger-600/30 bg-danger-100 p-3">
      <p className="text-xs font-semibold text-danger-600">How should this be deleted?</p>

      <div className="mt-2 space-y-2">
        <button
          type="button"
          onClick={() => {
            onDelete("soft");
            setOpen(false);
          }}
          className="w-full rounded border border-ink-200 bg-surface px-2.5 py-2 text-left text-xs hover:border-accent-500"
        >
          <span className="font-semibold text-ink-900">Soft delete</span>
          <span className="hint block">
            Hidden from the default list, kept in storage, restorable at any time via the “show
            deleted” filter.
          </span>
        </button>

        <div className="rounded border border-danger-600/30 bg-surface px-2.5 py-2">
          <span className="text-xs font-semibold text-danger-600">Hard delete</span>
          <span className="hint block">
            Permanently removes this snapshot and its section-visibility rows. This cannot be
            undone. Type <strong>DELETE</strong> to confirm.
          </span>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder="DELETE"
              aria-label="Type DELETE to confirm permanent deletion"
            />
            <button
              type="button"
              disabled={confirmText !== "DELETE"}
              onClick={() => {
                onDelete("hard");
                setOpen(false);
                setConfirmText("");
              }}
              className="shrink-0 rounded bg-danger-600 px-2.5 py-1 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-400"
            >
              Delete forever
            </button>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setConfirmText("");
        }}
        className="mt-2 text-xs font-medium text-ink-500 underline"
      >
        Cancel
      </button>
    </div>
  );
}
