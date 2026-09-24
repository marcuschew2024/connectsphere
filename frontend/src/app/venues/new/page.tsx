"use client";

import VenueWorkspace from "../venue-workspace";
import VenueForm from "./venue-form";

export default function NewVenuePage() {
  return <VenueWorkspace creating title="Add a venue" description="Register a space so Coordinators can find it when planning an event.">{() => <VenueForm />}</VenueWorkspace>;
}
