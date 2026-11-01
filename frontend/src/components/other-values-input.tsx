"use client";

import { useState, type KeyboardEvent } from "react";

const INPUT = "w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30";

function parseValues(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export default function OtherValuesInput({ id, label, value, onChange, placeholder }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const values = parseValues(value);

  const addDraft = () => {
    const additions = parseValues(draft);
    if (!additions.length) return;
    const next = [...values];
    additions.forEach((addition) => {
      if (!next.some((item) => item.toLowerCase() === addition.toLowerCase())) next.push(addition);
    });
    onChange(next.join(", "));
    setDraft("");
  };

  const removeValue = (removed: string) => {
    onChange(values.filter((item) => item.toLowerCase() !== removed.toLowerCase()).join(", "));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addDraft();
    }
  };

  return (
    <div className="mt-3 space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      <div className="flex gap-2">
        <input id={id} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKeyDown} maxLength={2000} placeholder={placeholder} className={INPUT} />
        <button type="button" onClick={addDraft} disabled={!draft.trim()} className="rounded-md border border-border px-4 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">Add</button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label={`${label} values`}>
          {values.map((item) => (
            <span key={item.toLowerCase()} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-sm">
              {item}
              <button type="button" aria-label={`Remove ${item}`} onClick={() => removeValue(item)} className="ml-1 rounded-full px-1 text-muted-foreground hover:bg-background hover:text-foreground">X</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
