"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ApiError, apiRequest } from "@/lib/api";
import { EQUIPMENT_STATUSES, type Equipment, equipmentTimestamp } from "@/lib/equipment";

const TEXT_FIELDS = [
  { name: "equipment_type", label: "Equipment type", limit: 100, placeholder: "e.g. Wireless microphone" },
  { name: "description", label: "Description", limit: 2000, placeholder: "Model, features and any condition notes" },
  { name: "location", label: "Location", limit: 300, placeholder: "e.g. Building B, AV store" },
] as const;

export default function EquipmentForm({ equipment }: { equipment?: Equipment }) {
  const [status, setStatus] = useState<string>(equipment?.operational_status ?? "Operational");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState<Equipment | null>(null);
  const feedback = useRef<HTMLDivElement>(null);

  useEffect(() => { if (error || saved) feedback.current?.focus(); }, [error, saved]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    const quantity = String(form.get("total_quantity") ?? "").trim();
    const details = {
      equipment_type: form.get("equipment_type"),
      description: form.get("description"),
      location: form.get("location"),
      total_quantity: quantity === "" ? null : Number(quantity),
      operational_status: status,
      ...(equipment ? { revision: equipment.revision } : {}),
    };
    setSaving(true);
    setError(null);
    try {
      const result = await apiRequest<{ equipment: Equipment }>(
        equipment ? `/equipment/${equipment.id}` : "/equipment",
        { method: equipment ? "PUT" : "POST", body: JSON.stringify(details) },
      );
      setSaved(result.equipment);
    } catch (problem) {
      setError(problem instanceof ApiError ? problem : new ApiError(
        "Could not confirm the save. Check the catalogue before retrying.", 0,
      ));
    } finally {
      setSaving(false);
    }
  }

  if (saved) return (
    <div ref={feedback} tabIndex={-1} className="max-w-2xl space-y-4 rounded-2xl border border-border bg-card p-6">
      <h2 className="text-xl font-semibold">Equipment {equipment ? "updated" : "added"}</h2>
      <p className="text-sm text-muted-foreground">
        {saved.equipment_type} has {saved.usable_quantity} usable units out of {saved.total_quantity} total.
        The change and its audit record have been saved.
      </p>
      <Button asChild><Link href="/equipment">View catalogue</Link></Button>
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="max-w-2xl space-y-6 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <p className="text-sm leading-relaxed text-muted-foreground">
        All fields are required. Keep units with the same type, description, location and condition together.
        Record units in different conditions as separate entries.
      </p>
      {error && (
        <div ref={feedback} tabIndex={-1} role="alert" className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <p>{error.message}</p>
          {error.status === 409 && (
            <Button type="button" variant="outline" onClick={() => window.location.reload()}>Reload latest version</Button>
          )}
          {(error.status === 0 || error.status >= 500) && <Link href="/equipment" className="block underline">Check catalogue</Link>}
        </div>
      )}
      <fieldset disabled={saving} className="space-y-5">
        <legend className="sr-only">Equipment details</legend>
        {TEXT_FIELDS.map(({ name, label, limit, placeholder }) => {
          const props = {
            id: name, name, maxLength: limit, required: true, placeholder,
            defaultValue: equipment?.[name] ?? "",
            "aria-invalid": Boolean(error?.fields[name]),
            "aria-describedby": error?.fields[name] ? `${name}-error` : undefined,
          };
          return (
            <div key={name} className="space-y-2">
              <label htmlFor={name} className="text-sm font-medium">{label}</label>
              {name === "description" ? <Textarea {...props} rows={4} /> : <Input {...props} />}
              {error?.fields[name] && <p id={`${name}-error`} className="text-sm text-destructive">{error.fields[name]}</p>}
            </div>
          );
        })}
        <div className="space-y-2">
          <label htmlFor="total_quantity" className="text-sm font-medium">Total quantity</label>
          <Input id="total_quantity" name="total_quantity" type="number" min={0} max={2147483647} step={1}
            required defaultValue={equipment?.total_quantity ?? ""} aria-invalid={Boolean(error?.fields.total_quantity)}
            aria-describedby="quantity-help quantity-error" />
          <p id="quantity-help" className="text-xs text-muted-foreground">A whole number, including zero. Count only the units in this entry.</p>
          <p id="quantity-error" className="text-sm text-destructive">{error?.fields.total_quantity}</p>
        </div>
        <div className="space-y-2">
          <label htmlFor="operational_status" className="text-sm font-medium">Operational status</label>
          <Select value={status} onValueChange={setStatus} disabled={saving}>
            <SelectTrigger id="operational_status" className="w-full" aria-invalid={Boolean(error?.fields.operational_status)}
              aria-describedby="status-help status-error"><SelectValue /></SelectTrigger>
            <SelectContent>{EQUIPMENT_STATUSES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
          </Select>
          <p id="status-help" className="text-xs text-muted-foreground">Damaged and maintenance entries contribute zero usable stock.</p>
          <p id="status-error" className="text-sm text-destructive">{error?.fields.operational_status}</p>
        </div>
      </fieldset>
      {equipment && (
        <p className="text-xs text-muted-foreground">
          Created by {equipment.creator?.display_name ?? `user ${equipment.created_by}`} on {equipmentTimestamp(equipment.created_at)} SGT.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : equipment ? "Save changes" : "Save equipment"}</Button>
        {!saving && <Button asChild variant="outline"><Link href="/equipment">Cancel</Link></Button>}
      </div>
    </form>
  );
}
