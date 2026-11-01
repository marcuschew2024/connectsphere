"use client";

import { useState } from "react";
import { VENUE_ACCESSIBILITY_FEATURES, VENUE_FACILITIES, VENUE_LAYOUTS } from "@/lib/venues";
import OtherValuesInput from "@/components/other-values-input";


const LEGACY_FACILITY_OTHER_VALUES = ["Blinds"];

function parse(value: string | null | undefined) {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function isLegacyFacilityOther(value: string) {
  return LEGACY_FACILITY_OTHER_VALUES.some((facility) => facility.toLowerCase() === value.toLowerCase());
}

function otherValues(values: string[], presets: string[]) {
  return values.filter((value) => value !== "__other__" && !presets.some((preset) => preset.toLowerCase() === value.toLowerCase()));
}

function OptionGroup({ label, options, name, selected, onChange, other, onOtherChange }: {
  label: string;
  options: string[];
  name: string;
  selected: string[];
  onChange: (values: string[]) => void;
  other: string;
  onOtherChange: (value: string) => void;
}) {
  const hasOther = selected.includes("__other__") || otherValues(selected, options).length > 0;
  const toggle = (option: string, checked: boolean) => {
    onChange(checked ? [...selected, option] : selected.filter((value) => value.toLowerCase() !== option.toLowerCase()));
  };
  return (
    <fieldset className="space-y-3">
      <legend className="font-medium">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label key={option} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm has-checked:border-primary/50 has-checked:bg-primary/5">
            <input type="checkbox" checked={selected.some((value) => value.toLowerCase() === option.toLowerCase())} onChange={(event) => toggle(option, event.target.checked)} className="h-4 w-4 accent-primary" />
            {option}
          </label>
        ))}
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm has-checked:border-primary/50 has-checked:bg-primary/5">
          <input type="checkbox" aria-label={`${label} Other`} checked={hasOther} onChange={(event) => {
            if (event.target.checked && !otherValues(selected, options).length) {
              onChange([...selected, "__other__"]);
              return;
            }
            if (!event.target.checked) onChange(selected.filter((value) => options.some((option) => option.toLowerCase() === value.toLowerCase())));
          }} className="h-4 w-4 accent-primary" />
          Other
        </label>
      </div>
      {hasOther && (
        <OtherValuesInput id={`${name || label}-other`} label={`Other ${label.toLowerCase()}`} value={other} onChange={onOtherChange} placeholder="Enter one or more values separated by commas" />
      )}
      {name && <input type="hidden" name={name} value={[...selected.filter((value) => options.some((option) => option.toLowerCase() === value.toLowerCase())), ...parse(hasOther ? other : "")].join(", ")} />}
    </fieldset>
  );
}

export default function EventVenueOptions({ venueRequirements, facilityRequirements, accessibilityRequirements }: {
  venueRequirements?: string | null;
  facilityRequirements?: string | null;
  accessibilityRequirements?: string | null;
}) {
  const venueValues = parse(venueRequirements);
  const [facilities, setFacilities] = useState(parse(facilityRequirements).concat(venueValues.filter((value) => VENUE_FACILITIES.some((option) => option.toLowerCase() === value.toLowerCase()) || isLegacyFacilityOther(value))));
  const [layouts, setLayouts] = useState(venueValues.filter((value) => !VENUE_FACILITIES.some((option) => option.toLowerCase() === value.toLowerCase()) && !isLegacyFacilityOther(value)));
  const [accessibility, setAccessibility] = useState(parse(accessibilityRequirements));
  const [layoutOther, setLayoutOther] = useState(otherValues(layouts, VENUE_LAYOUTS).join(", "));
  const [facilityOther, setFacilityOther] = useState(otherValues(facilities, VENUE_FACILITIES).join(", "));
  const [accessibilityOther, setAccessibilityOther] = useState(otherValues(accessibility, VENUE_ACCESSIBILITY_FEATURES).join(", "));

  return (
    <div className="space-y-5">
      <OptionGroup label="Layouts" options={VENUE_LAYOUTS} name="" selected={layouts} onChange={setLayouts} other={layoutOther} onOtherChange={setLayoutOther} />
      <input type="hidden" name="venue_requirements" value={[
        ...layouts.filter((value) => value !== "__other__"),
        ...parse(layoutOther),
      ].join(", ")} />
      <OptionGroup label="Facilities" options={VENUE_FACILITIES} name="" selected={facilities} onChange={setFacilities} other={facilityOther} onOtherChange={setFacilityOther} />
      <input type="hidden" name="facility_requirements" value={[...facilities.filter((value) => VENUE_FACILITIES.some((option) => option.toLowerCase() === value.toLowerCase()) && value !== "__other__"), ...parse(facilityOther)].join(", ")} />
      <OptionGroup label="Accessibility features" options={VENUE_ACCESSIBILITY_FEATURES} name="accessibility_requirements" selected={accessibility} onChange={setAccessibility} other={accessibilityOther} onOtherChange={setAccessibilityOther} />
    </div>
  );
}
