"use client";

import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api";

type AvailabilityData = {
  equipment_id: string;
  equipment_type: string;
  total_quantity: number;
  operational_status: string;
  usable_quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  requested_quantity: number;
  is_sufficient: boolean;
  overlapping_reservations_count: number;
  start_at: string;
  end_at: string;
};

export default function EquipmentAvailabilityModal({
  equipmentId,
  equipmentType,
  isOpen,
  role,
  onClose,
}: {
  equipmentId: string;
  equipmentType: string;
  isOpen: boolean;
  role?: string;
  onClose: () => void;
}) {
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [eventId, setEventId] = useState("");
  const [loading, setLoading] = useState(false);
  const [reserving, setReserving] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [result, setResult] = useState<AvailabilityData | null>(null);

  if (!isOpen) return null;

  async function handleCheck(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccessMessage("");
    setResult(null);

    if (!startAt || !endAt) {
      setError("Please select both start and end date/time.");
      return;
    }

    const startDate = new Date(startAt);
    const endDate = new Date(endAt);
    if (endDate <= startDate) {
      setError("End time must be after start time.");
      return;
    }

    setLoading(true);
    try {
      const startIso = startDate.toISOString();
      const endIso = endDate.toISOString();
      const res = await apiRequest<{ availability: AvailabilityData }>(
        `/equipment/${equipmentId}/availability?start_at=${encodeURIComponent(
          startIso
        )}&end_at=${encodeURIComponent(endIso)}&quantity=${encodeURIComponent(quantity)}`
      );
      setResult(res.availability);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to check equipment availability.");
    } finally {
      setLoading(false);
    }
  }

  async function handleReserve() {
    if (!result || !startAt || !endAt) return;
    setError("");
    setSuccessMessage("");
    setReserving(true);

    try {
      const startIso = new Date(startAt).toISOString();
      const endIso = new Date(endAt).toISOString();
      const res = await apiRequest<{ message: string; reservation: unknown }>(
        `/equipment/${equipmentId}/reservations`,
        {
          method: "POST",
          body: JSON.stringify({
            start_at: startIso,
            end_at: endIso,
            quantity: Number(quantity),
            event_id: eventId.trim() || undefined,
          }),
        }
      );
      setSuccessMessage(res.message);
      // Refresh live availability for the slot
      const refreshed = await apiRequest<{ availability: AvailabilityData }>(
        `/equipment/${equipmentId}/availability?start_at=${encodeURIComponent(
          startIso
        )}&end_at=${encodeURIComponent(endIso)}&quantity=${encodeURIComponent(quantity)}`
      );
      setResult(refreshed.availability);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to reserve equipment.");
    } finally {
      setReserving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="availability-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl border border-border">
        <h2 id="availability-modal-title" className="text-lg font-semibold">
          Check Availability: {equipmentType}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Query available units for a specific date and time window.
        </p>

        <form onSubmit={handleCheck} className="mt-4 space-y-4">
          <div>
            <Label htmlFor="start_at">Start Date & Time</Label>
            <Input
              id="start_at"
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              required
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="end_at">End Date & Time</Label>
            <Input
              id="end_at"
              type="datetime-local"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
              required
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="req_qty">Quantity Needed</Label>
            <Input
              id="req_qty"
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
              className="mt-1"
            />
          </div>

          {role === "Tech Support" && (
            <div>
              <Label htmlFor="event_id">Event Reference (Optional)</Label>
              <Input
                id="event_id"
                type="text"
                placeholder="e.g. event UUID"
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                className="mt-1 font-mono text-xs"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Associates this reservation with an event. Auto-releases if event is cancelled.
              </p>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive font-medium">
              {error}
            </p>
          )}

          {successMessage && (
            <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">
              {successMessage}
            </p>
          )}

          {result && (
            <div
              className={`rounded-xl border p-4 space-y-2 text-sm ${
                result.is_sufficient
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-950 dark:text-emerald-200"
                  : "border-destructive/30 bg-destructive/10 text-destructive"
              }`}
            >
              <div className="flex items-center gap-2 font-semibold">
                {result.is_sufficient ? (
                  <>
                    <CheckCircle2 className="size-5 text-emerald-600" />
                    <span>Sufficient units available</span>
                  </>
                ) : (
                  <>
                    <XCircle className="size-5 text-destructive" />
                    <span>Insufficient units available</span>
                  </>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50 text-xs">
                <div>Total Catalogue Stock: <strong>{result.total_quantity}</strong></div>
                <div>Status: <strong>{result.operational_status}</strong></div>
                <div>Reserved in slot: <strong>{result.reserved_quantity}</strong></div>
                <div>Available to reserve: <strong className="text-sm">{result.available_quantity}</strong></div>
              </div>
            </div>
          )}

          <div className="flex flex-col-reverse gap-2.5 pt-4 sm:flex-row sm:items-center sm:justify-end border-t border-border/60">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
            >
              Close
            </Button>
            <Button
              type="submit"
              variant="outline"
              disabled={loading || reserving}
              className="border-border/80 shadow-xs hover:bg-muted/60"
            >
              {loading ? "Checking…" : "Check Availability"}
            </Button>
            {role === "Tech Support" && result && result.is_sufficient && (
              <Button
                type="button"
                variant="default"
                disabled={reserving || loading}
                onClick={handleReserve}
                className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                {reserving ? "Reserving…" : "Reserve Units"}
              </Button>
            )}
          </div>
        </form>

      </div>
    </div>
  );
}
